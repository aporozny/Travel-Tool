import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import * as Keychain from 'react-native-keychain';
import axios from 'axios';
import { User } from '../types';

const BASE_URL = __DEV__
  ? 'http://10.0.2.2:5000/api/v1'
  : 'https://api.travel-tool.com/api/v1';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
};

export const register = createAsyncThunk(
  'auth/register',
  async (payload: { email: string; password: string; role: 'traveler' | 'operator' }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(`${BASE_URL}/auth/register`, payload);
      await Keychain.setGenericPassword('token', data.accessToken, { service: 'access_token' });
      await Keychain.setGenericPassword('token', data.refreshToken, { service: 'refresh_token' });
      return data.user as User;
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || 'Registration failed');
    }
  }
);

export const login = createAsyncThunk(
  'auth/login',
  async (payload: { email: string; password: string }, { rejectWithValue }) => {
    try {
      const { data } = await axios.post(`${BASE_URL}/auth/login`, payload);
      await Keychain.setGenericPassword('token', data.accessToken, { service: 'access_token' });
      await Keychain.setGenericPassword('token', data.refreshToken, { service: 'refresh_token' });
      return data.user as User;
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.message || 'Login failed');
    }
  }
);

export const logout = createAsyncThunk('auth/logout', async () => {
  await Keychain.resetGenericPassword({ service: 'access_token' });
  await Keychain.resetGenericPassword({ service: 'refresh_token' });
});

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<User>) => {
      state.user = action.payload;
      state.isAuthenticated = true;
    },
    clearError: (state) => { state.error = null; },
  },
  extraReducers: builder => {
    builder
      .addCase(register.pending, state => { state.isLoading = true; state.error = null; })
      .addCase(register.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload;
        state.isAuthenticated = true;
      })
      .addCase(register.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      .addCase(login.pending, state => { state.isLoading = true; state.error = null; })
      .addCase(login.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload;
        state.isAuthenticated = true;
      })
      .addCase(login.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      .addCase(logout.fulfilled, state => {
        state.user = null;
        state.isAuthenticated = false;
      });
  },
});

export const { setUser, clearError } = authSlice.actions;
export default authSlice.reducer;
