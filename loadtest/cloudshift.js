import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const apiUrl = (__ENV.API_URL || 'http://localhost:4000').replace(/\/$/, '');
const failures = new Counter('cloudshift_failed_requests');
const migrationErrors = new Rate('cloudshift_migration_errors');
const responseTime = new Trend('cloudshift_api_latency', true);

export const options = {
  scenarios: {
    steady_api_traffic: {
      executor: 'ramping-vus',
      startVUs: 2,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '2m', target: 10 },
        { duration: '30s', target: 0 }
      ],
      gracefulRampDown: '10s'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<750'],
    cloudshift_migration_errors: ['rate<0.02']
  }
};

export default function () {
  const users = http.get(`${apiUrl}/api/users?page=${(__VU % 100) + 1}&pageSize=10`);
  responseTime.add(users.timings.duration);
  check(users, { 'users endpoint responds successfully': (response) => response.status === 200 });
  if (users.status >= 400) failures.add(1);
  migrationErrors.add(users.status >= 500);

  const health = http.get(`${apiUrl}/api/health`);
  check(health, { 'health endpoint responds successfully': (response) => response.status === 200 });
  if (health.status >= 400) failures.add(1);
  migrationErrors.add(health.status >= 500);
  sleep(0.5);
}
