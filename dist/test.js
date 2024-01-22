"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const http = __importStar(require("http"));
const drl = __importStar(require("./src/lib"));
function testReq() {
    return new Promise((resolve, reject) => {
        const r = http.request({
            host: '127.0.0.1',
            port: 11111,
        }, (res) => {
            if (res.statusCode === 429) {
                reject(new Error('too many reqs'));
            }
            else {
                resolve(null);
            }
        });
        r.end();
    });
}
async function test() {
    console.log('start');
    const rl = new drl.DistributedRateLimiter('127.0.0.1', 6379);
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
