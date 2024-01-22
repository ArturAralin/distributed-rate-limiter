import * as http from 'http';
import * as drl from './src/lib';

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

async function test() {
  console.log('start');
  const rl = new drl.DistributedRateLimiter(
    '127.0.0.1',
    6379
  );

  await rl.registerLimiter({
    key: 'test_key',
    interval: 1000,
    rate: 3,
  });

  const intervalId = setInterval(async () => {
    await rl.run('test_key', async () => {
      await testReq();
    });
    await rl.run('test_key', async () => {
      await testReq();
    });
  }, 100);

  setTimeout(() => {
    clearInterval(intervalId);
  }, 1000);
}

test();
