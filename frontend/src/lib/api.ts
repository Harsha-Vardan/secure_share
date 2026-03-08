import axios from 'axios';

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export const api = axios.create({
    baseURL: BACKEND_URL,
    headers: {
        'Content-Type': 'application/json'
    }
});

// Add a request interceptor to append the JWT token
api.interceptors.request.use((config) => {
    if (typeof window !== 'undefined') {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
    }
    return config;
});
