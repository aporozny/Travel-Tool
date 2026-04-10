import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as Keychain from 'react-native-keychain';

const BASE_URL = __DEV__
  ? 'http://10.0.2.2:5000/api/v1'
  : 'https://api.travel-tool.com/api/v1';

const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const creds = await Keychain.getGenericPassword({ service: 'access_token' });
  if (creds) {
    config.headers.Authorization = `Bearer ${creds.password}`;
  }
  return config;
});

api.interceptors.response.use(
  res => res,
  async error => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refreshCreds = await Keychain.getGenericPassword({ service: 'refresh_token' });
        if (!refreshCreds) throw new Error('No refresh token');

        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
          refreshToken: refreshCreds.password,
        });

        await Keychain.setGenericPassword('token', data.accessToken, { service: 'access_token' });
        if (data.refreshToken) {
          await Keychain.setGenericPassword('token', data.refreshToken, { service: 'refresh_token' });
        }

        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        await Keychain.resetGenericPassword({ service: 'access_token' });
        await Keychain.resetGenericPassword({ service: 'refresh_token' });
      }
    }
    return Promise.reject(error);
  }
);

export default api;
