const http = require('http');

const server = require('./server.js');

setTimeout(() => {
  http.get('http://localhost:3012/health', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const body = JSON.parse(data);
        if (body.status === 'ok' && body.port === 3012) {
          console.log('[health-check] PASS — server healthy on port 3012, dataLoaded:', body.dataLoaded);
          process.exit(0);
        } else {
          console.error('[health-check] FAIL — unexpected response:', data);
          process.exit(1);
        }
      } catch (e) {
        console.error('[health-check] FAIL — JSON parse error:', e.message);
        process.exit(1);
      }
    });
  }).on('error', (e) => {
    console.error('[health-check] FAIL — connection error:', e.message);
    process.exit(1);
  });
}, 2000);
