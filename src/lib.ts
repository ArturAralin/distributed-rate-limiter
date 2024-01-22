import { Redis } from 'ioredis';

interface Job<T = any> {
  id: number;
  state: 'delayed' | 'wait' | 'in_progress' | 'done';
  callback: () => any;
  resolve: (v: T) => void;
  reject: (r?: any) => void;
  promise: Promise<T>;
}

function createJob<T>(callback: () => any): Job<T> {
  const job: Record<any, any> = {
    callback,
    state: 'wait',
  };

  const promise = new Promise((resolve, reject) => {
    job.resolve = resolve;
    job.reject = reject;
  });

  job.promise = promise;

  return job as Job<T>;
}

class DistributedRateLimiterJob {
  private readonly jobs: Record<string, Job> = {};

  private localJobId: number = 0;

  private waitingJobs: number = 0;

  constructor(
    private readonly keyPrefix: string,
    private readonly key: string,
    private readonly redis: Redis,
  ) {}

  public rerun() {
    Object.values(this.jobs).forEach((job) => {
      if (job.state === 'delayed') {
        this.run(job);
      }
    });
  }

  async run(job: Job) {
    if (!job.id) {
      job.id = ++this.localJobId;
      this.waitingJobs += 1;
    }

    this.jobs[job.id] = job;

    const evalResult = await this.redis.eval(`
    local interval = tonumber(redis.call('GET', '${this.getIntervalKey()}'));
    local max = tonumber(redis.call('GET', '${this.getRateKey()}'));
    local counter = redis.call('INCR', '${this.getCounterKey()}');

    if counter == 1 then
      redis.call('PEXPIRE', '${this.getCounterKey()}', interval)
    end

    if counter <= max then
      return 'true'
    else
      return 'false'
    end
  `, 0) as string;

    const allowed = JSON.parse(evalResult);

    if (!allowed) {
      job.state = 'delayed';

      return job.promise;
    }

    this.waitingJobs = Math.max(
      this.waitingJobs - 1,
      0
    );
    this.jobs[job.id].state = 'in_progress';

    try {
      job.resolve(await job.callback());
    } catch (e) {
      job.reject(e);
    } finally {
      this.jobs[job.id].state = 'done';
      delete this.jobs[job.id];
    }

    return job.promise;
  }

  public getRateKey(): string {
    return this.buildKey(`${this.key}_limit`);
  }

  public getIntervalKey(): string {
    return this.buildKey(`${this.key}_interval`);
  }

  public getCounterKey(): string {
    return this.buildKey(`${this.key}_counter`);
  }

  private buildKey(suffix: string) {
    return `${this.keyPrefix}${suffix}`;
  }
}


interface RegisterLimiterParams {
  key: string;
  interval: number;
  rate: number;
}

export class DistributedRateLimiter {
  private keyPrefix: string = 'drl:';

  private jobs: Record<string, DistributedRateLimiterJob> = {};

  private redis: Redis;

  private pubSub: Redis;

  private initialized: boolean = false;

  constructor(redisHost: string, redisPort: number) {
    this.redis = new Redis({
      port: redisPort,
      host: redisHost,
    });

    this.pubSub = new Redis({
      port: redisPort,
      host: redisHost,
    });
  }

  async registerLimiter(params: RegisterLimiterParams) {
    if (!this.initialized) {
      await this.pubSub.config('SET', 'notify-keyspace-events', 'Ex');
      await this.pubSub.subscribe("__keyevent@0__:expired");

      this.pubSub.on('message', this.onRedisExpireMessage.bind(this));

      this.initialized = true;
    }

    const {
      key,
      interval,
      rate,
    } = params;

    const j = new DistributedRateLimiterJob(
      this.keyPrefix,
      key,
      this.redis,
    );

    await this.redis.set(j.getRateKey(), rate);
    await this.redis.set(j.getIntervalKey(), interval);

    this.jobs[j.getCounterKey()] = j;
  }

  async run<T>(key: string, cb: () => T): Promise<T> {
    const job = createJob<T>(cb);

    const counterKey = `${this.keyPrefix}${key}_counter`;

    this.jobs[counterKey].run(job);

    return job.promise;
  }

  private onRedisExpireMessage(_: unknown, key: string) {
    if (this.jobs[key]) {
      this.jobs[key].rerun();
    }
  }
}

