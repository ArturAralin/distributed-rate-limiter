const http = require('http');

let calls = 0;
const max = 30;

setInterval(() => {
  calls = 0;
}, 1000);

const server = http.createServer((req, res) => {
  calls += 1;
  console.log('calls', calls);
  if (calls > max) {
    res.statusCode = 429;
  } else {
    res.statusCode = 200;
  }

  res.end();
});

server.listen(11111);

