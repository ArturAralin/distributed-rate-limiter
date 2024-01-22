// const Semaphore = require('redis-semaphore').Semaphore
const Redis = require('ioredis')

const redisClient = new Redis({
  port: 6379, // Redis port
  host: "127.0.0.1", // Redis host
});

class RateLimit {
  constructor(redis, resource) {
    this.redis = redis;
    this.resource = resource;
    this.count = 5;
    this.interval = 1000;
    this.attempt = 0;
    this.maxAttempts = 5;
  }

  async wait() {
    this.attempt += 1;

    if (this.attempt > this.maxAttempts) {
      throw new Error('Max attempts overflow');
    }

    const counter_key = `test_test_${this.resource}`;

    await this.redis.set(counter_key, 1, 'NX', 'PX', 1000);

    const count = await this.redis.incr(counter_key);

    if (count === 1) {
      throw new Error('key set by count');
    }

    if (count >= this.count) {
      const e = await this.redis.pttl(counter_key);


      console.log('e', e);
      if (e > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, e)
        });
      }

      return this.wait();
    }

    // console.log(i);
    // if (i === 1) {
    //   console.log('FIRST!', this.resource);
    // }
  }
}

const limits = {
  'first': 0,
  'second': 0,
};

const MAX = 5;

setInterval(() => {
  limits.first = 0;
  limits.second = 0;
  console.log('reset');
}, 1000);


async function callApi(res) {
  const rl = new RateLimit(redisClient, res);

  await rl.wait();

  if (limits[res] > MAX) {
    // console.log('error', res);

    return;
  }

  limits[res] += 1;
}


setInterval(async () => {
  await callApi('first');
}, 50);

setInterval(async () => {
  await callApi('first');
}, 48);

setInterval(async () => {
  await callApi('second');
}, 30);
