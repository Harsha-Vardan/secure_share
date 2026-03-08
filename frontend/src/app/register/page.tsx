'use client';
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import Link from 'next/link';

export default function Register() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            await api.post('/auth/register', { email, password });
            // Auto login after register
            const res = await api.post('/auth/login', { email, password });
            login(res.data.token, { id: res.data.userId, email: res.data.email });
        } catch (err: any) {
            setError(err.response?.data?.error || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-neutral-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <h2 className="mt-6 text-center text-3xl font-extrabold text-white">Create an account</h2>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-neutral-900 py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-neutral-800">
                    <form className="space-y-6" onSubmit={handleSubmit}>
                        {error && <div className="text-red-500 text-sm bg-red-500/10 p-3 rounded-md border border-red-500/20">{error}</div>}
                        
                        <div>
                            <label className="block text-sm font-medium text-neutral-300">Email address</label>
                            <div className="mt-1">
                                <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                                    className="appearance-none block w-full px-3 py-2 border border-neutral-700 bg-neutral-800 rounded-md shadow-sm placeholder-neutral-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-white" />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-neutral-300">Password</label>
                            <div className="mt-1">
                                <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                                    className="appearance-none block w-full px-3 py-2 border border-neutral-700 bg-neutral-800 rounded-md shadow-sm placeholder-neutral-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-white" />
                            </div>
                        </div>

                        <div>
                            <button type="submit" disabled={loading}
                                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50">
                                {loading ? 'Registering...' : 'Register'}
                            </button>
                        </div>
                    </form>

                    <div className="mt-6 text-center text-sm text-neutral-400">
                        Already have an account?{' '}
                        <Link href="/login" className="font-medium text-blue-500 hover:text-blue-400">
                            Login
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
