"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DistributedRateLimiter = void 0;
const ioredis_1 = require("ioredis");
function createJob(callback) {
    const job = {
        callback,
        state: 'wait',
    };
    const promise = new Promise((resolve, reject) => {
        job.resolve = resolve;
        job.reject = reject;
    });
    job.promise = promise;
    return job;
}
class DistributedRateLimiterJob {
    keyPrefix;
    key;
    redis;
    jobs = {};
    localJobId = 0;
    constructor(keyPrefix, key, redis) {
        this.keyPrefix = keyPrefix;
        this.key = key;
        this.redis = redis;
    }
    rerun() {
        Object.values(this.jobs).forEach((job) => {
            if (job.state === 'delayed') {
                this.run(job);
            }
        });
    }
    async run(job) {
        if (!job.id) {
            job.id = ++this.localJobId;
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
  `, 0);
        const allowed = JSON.parse(evalResult);
        console.log('allowed', allowed);
        if (!allowed) {
            job.state = 'delayed';
            return job.promise;
        }
        this.jobs[job.id].state = 'in_progress';
        try {
            job.resolve(await job.callback());
        }
        catch (e) {
            job.reject(e);
        }
        finally {
            this.jobs[job.id].state = 'done';
            delete this.jobs[job.id];
        }
        return job.promise;
    }
    getRateKey() {
        return this.buildKey(`${this.key}_limit`);
    }
    getIntervalKey() {
        return this.buildKey(`${this.key}_interval`);
    }
    getCounterKey() {
        return this.buildKey(`${this.key}_counter`);
    }
    buildKey(suffix) {
        return `${this.keyPrefix}${suffix}`;
    }
}
class DistributedRateLimiter {
    keyPrefix = 'drl:';
    jobs = {};
    redis;
    pubSub;
    initialized = false;
    constructor(redisHost, redisPort) {
        this.redis = new ioredis_1.Redis({
            port: redisPort,
            host: redisHost,
        });
        this.pubSub = new ioredis_1.Redis({
            port: redisPort,
            host: redisHost,
        });
    }
    async registerLimiter(params) {
        if (!this.initialized) {
            console.log('subscribe');
            await this.pubSub.config('SET', 'notify-keyspace-events', 'Ex');
            await this.pubSub.subscribe("__keyevent@0__:expired");
            this.pubSub.on('message', (...a) => {
                console.log('a', a);
            });
            this.pubSub.on('message', this.onRedisExpireMessage.bind(this));
            this.initialized = true;
        }
        const { key, interval, rate, } = params;
        const j = new DistributedRateLimiterJob(this.keyPrefix, key, this.redis);
        await this.redis.set(j.getRateKey(), rate);
        await this.redis.set(j.getIntervalKey(), interval);
        this.jobs[j.getCounterKey()] = j;
    }
    async run(key, cb) {
        const job = createJob(cb);
        const counterKey = `${this.keyPrefix}${key}_counter`;
        this.jobs[counterKey].run(job);
        return job.promise;
    }
    onRedisExpireMessage(_, key) {
        if (this.jobs[key]) {
            this.jobs[key].rerun();
        }
    }
}
exports.DistributedRateLimiter = DistributedRateLimiter;
