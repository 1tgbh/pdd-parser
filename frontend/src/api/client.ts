import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';

let sessionToken = '';
let sessionRequest: Promise<string> | undefined;

function session(): Promise<string> {
  if (sessionToken) return Promise.resolve(sessionToken);
  if (!sessionRequest) {
    sessionRequest = axios.get<{ token: string }>('/api/session', { timeout: 10000 })
      .then(({ data }) => { sessionToken = data.token; return sessionToken; })
      .finally(() => { sessionRequest = undefined; });
  }
  return sessionRequest;
}

function createClient(timeout: number) {
  const instance = axios.create({ baseURL: '/api', timeout });
  instance.interceptors.request.use(async config => {
    config.headers.set('X-PDD-Token', await session());
    return config;
  });
  instance.interceptors.response.use(undefined, async error => {
    const config = error.config as (InternalAxiosRequestConfig & { sessionRetried?: boolean }) | undefined;
    if (error.response?.status === 401 && config && !config.sessionRetried) {
      config.sessionRetried = true;
      if (config.headers.get('X-PDD-Token') === sessionToken) sessionToken = '';
      return instance.request(config);
    }
    throw error;
  });
  return instance;
}

export const client = createClient(15000);
export const aiClient = createClient(300000);
