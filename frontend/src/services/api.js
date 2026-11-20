import axios from 'axios';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const api = axios.create({
  baseURL: `${API_URL}/api`,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pos-auth-token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const socket = io(import.meta.env.VITE_SOCKET_URL || API_URL, {
  autoConnect: false,
});

export default api;
