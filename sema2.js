// const Semaphore = require('redis-semaphore').Semaphore
const Redis = require('ioredis')

const redisClient = new Redis({
  port: 6379, // Redis port
  host: "127.0.0.1", // Redis host
});

const pubSubRedis = new Redis({
  port: 6379, // Redis port
  host: "127.0.0.1", // Redis host
});

pubSubRedis.config('set', 'notify-keyspace-events', 'KEA');
pubSubRedis.subscribe("__keyevent@0__:expired")


const MAX = 3;
const INTERVAL = 1000;

const linkedList = {
  head: null,
  tail: null,
};

function createNode(cb) {
  const node = {
    id: Date.now(),
    cb,
    next: null,
  };

  const promise = new Promise((resolve, reject) => {
    node.resolve = resolve;
    node.reject = reject;
  });

  node.promise = promise;

  return node;
}

const delayedJobs = [];

const limKey = 'limiter_key';
async function lc(job) {

  try {
    const v = await redisClient.incr(limKey);

    if (v === 1) {
      await redisClient.pexpire(limKey, INTERVAL);
    }

    if (v > MAX) {
      job.state = 'delayed'
      // console.log('job', job.id, 'set to delayed');
      delayedJobs.push(job);
    } else {
      job.state = 'in_progress';
      // console.log('job', job.id, job.state);
      await job.cb();
      job.state = 'done';
      // console.log('job', job.id, job.state);
    }

  } catch (e) {
    console.log('e', e);
  }

  // console.log(linkedList);
}

pubSubRedis.once('message', async(_, message) => {
  if (message === limKey) {
    // console.log('expire message got for', job.id);
    delayedJobs.forEach(j => lc(j))
  }
})

let inProgress = 0;

setInterval(() => {
  if (inProgress > 0) {
    console.log('now in prog', inProgress);
  }
}, 50)

let id = 0;


setInterval(() => {
  id++;
  lc({
    id,
    state: 'wait',
    async cb() {
      inProgress += 1;
      await new Promise((resolve) => setTimeout(resolve, 1000, null));
      inProgress -= 1;
    }
  });
}, 200);
