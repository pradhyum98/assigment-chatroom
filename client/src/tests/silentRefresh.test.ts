import { describe, it, expect, vi, beforeEach } from 'vitest';
import api, { getAccessToken, setAccessToken } from '../services/api';
import { store } from '../store';
import axios from 'axios';

describe('Axios Silent Refresh Interceptor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setAccessToken(null);
  });

  it('attempts to silent refresh on 401 access token expiration and retries original request', async () => {
    setAccessToken('expired-access-token');
    
    const mockUser = { _id: '123', email: 'test@example.com' };
    const mockNewAccessToken = 'fresh-new-access-token';

    // Spy on global axios.post to mock silent refresh endpoint
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({
      data: {
        success: true,
        data: {
          token: mockNewAccessToken,
          user: mockUser
        }
      }
    });

    let callCount = 0;
    const mockAdapter = async (config: any) => {
      callCount++;
      if (callCount === 1) {
        const error = new Error('Request failed with status code 401') as any;
        error.response = {
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          config,
          data: { message: 'Unauthorized' }
        };
        error.config = config;
        throw error;
      }
      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
        data: { success: true, result: 'Retried Data' }
      };
    };

    // Act: make request passing the mock adapter
    const result = await api.request({
      url: '/rooms',
      method: 'GET',
      adapter: mockAdapter
    });

    // Assert
    expect(postSpy).toHaveBeenCalledWith(expect.stringContaining('/auth/refresh'), {}, expect.any(Object));
    expect(getAccessToken()).toBe(mockNewAccessToken);
    expect(store.getState().auth.token).toBe(mockNewAccessToken);
    expect(store.getState().auth.isAuthenticated).toBe(true);
    expect(result.data.success).toBe(true);
    expect(result.data.result).toBe('Retried Data');
  });

  it('logs out the user if the refresh token request itself fails with 401', async () => {
    setAccessToken('expired-access-token');

    // Simulate refresh endpoint failure
    const postSpy = vi.spyOn(axios, 'post').mockRejectedValue({
      response: { status: 401 }
    });

    const mockAdapter = async (config: any) => {
      const error = new Error('Request failed with status code 401') as any;
      error.response = {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config,
        data: { message: 'Unauthorized' }
      };
      error.config = config;
      throw error;
    };

    // Act & Assert
    await expect(
      api.request({
        url: '/rooms',
        method: 'GET',
        adapter: mockAdapter
      })
    ).rejects.toThrow();

    expect(postSpy).toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();

    // Await async logout thunk completion
    await new Promise<void>((resolve) => {
      const check = () => {
        if (store.getState().auth.token === null) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });

    expect(store.getState().auth.token).toBeNull();
    expect(store.getState().auth.isAuthenticated).toBe(false);
  });
});
