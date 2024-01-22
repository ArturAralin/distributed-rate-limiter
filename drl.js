const Redis = require('ioredis')
const http = require('http');

function testReq() {
  return new Promise((resolve, reject) => {
    const r = http.request({
      host: '127.0.0.1',
      port: 11111,
    }, (res) => {
      if (res.statusCode === 429) {
        reject(new Error('too many reqs'));
      } else {
        resolve(null);
      }
    });

    r.end();
  })
}

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


const lua2 = `
local interval = 1000;
local max = ;

local counter = redis.call('INCR', 'lua_counter')

if counter == 1 then
  redis.call('PEXPIRE', 'lua_counter', interval)
end

if counter <= max then
  return 'true'
else
  return 'false'
end
`;

class DistributedRateLimiter {
  constructor() {
    this.limit = 3;
    this.refresh = 1000;
    this.jobs = {};
    this.key = 'limit_key';
    this.jobId = 0;
    this.initialized = false;

    this.redis = new Redis({
      port: 6379,
      host: "127.0.0.1", // Redis host
    });

    this.pubSubRedis = new Redis({
      port: 6379,
      host: "127.0.0.1",
    });
  }

  async init() {
    try {
      await this.redis.defineCommand('echo', {
        numberOfKeys: 0,
        lua: lua2
      });
      // const r = await this.redis.echo();
      // console.log('r', r);
    } catch (e) {
      console.log('e', e);
    }
    await this.pubSubRedis.config('set', 'notify-keyspace-events', 'E');
    await this.pubSubRedis.subscribe("__keyevent@0__:expired");
    this.pubSubRedis.on('message', this.redisExpireMessage.bind(this));

    await this.redis.set(`${this.key}_limit`, 30);
    await this.redis.set(`${this.key}_refresh`, 1000);
  }

  redisExpireMessage(_, key) {
    if (key === this.key) {
      Object.values(this.jobs).slice(0, 30).forEach((job) => {
        if (job.state === 'delayed') {
          this.run(job);
        }
      });
    }
  }

  async run(job) {
    if (!job.id) {
      job.id = ++this.jobId;
    }

    this.jobs[job.id] = job;

    const allowed = JSON.parse(await this.redis.echo());

    if (!allowed) {
      job.state = 'delayed';

      return job.promise;
    }

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

  // async run(job) {
  //   if (!job.id) {
  //     job.id = ++this.jobId;
  //   }

  //   // update by event
  //   const x = await this.redis.mget([
  //     `${this.key}_limit`,
  //     `${this.key}_refresh`,
  //     `${this.key}_in_prog`,
  //   ]);

  //   const limit = parseInt(x[0], 10);
  //   const refresh = parseInt(x[1], 10);
  //   const inProgress = parseInt(x[2], 10);

  //   // use lua?
  //   const execsAtPeriod = await this.redis.incr(this.key);

  //   if (execsAtPeriod === 1) {
  //     await this.redis.pexpire(this.key, refresh);
  //   }

  //   this.jobs[job.id] = job;

  //   const inPrgr = Math.max(execsAtPeriod, inProgress);

  //   if (inPrgr > limit) {
  //     job.state = 'delayed';

  //     return job.promise;
  //   }

  //   this.jobs[job.id].state = 'in_progress';

  //   await this.redis.incr(`${this.key}_in_prog`);

  //   try {
  //     job.resolve(await job.callback());
  //   } catch (e) {
  //     job.reject(e);
  //   } finally {
  //     this.jobs[job.id].state = 'done';
  //     delete this.jobs[job.id];
  //     await this.redis.decr(`${this.key}_in_prog`);
  //   }

  //   return job.promise;
  // }
}

const o = new DistributedRateLimiter();

o.init();

setInterval(() => {
  o.run(createJob(async () => {
    // await new Promise((resolve) => setTimeout(resolve, 1000, null));
    await testReq();
  }));
  o.run(createJob(async () => {
    // await new Promise((resolve) => setTimeout(resolve, 1000, null));
    await testReq();
  }));
}, 50);
