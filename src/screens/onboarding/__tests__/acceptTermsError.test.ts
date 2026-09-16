import { AxiosError, AxiosHeaders } from 'axios';
import { Alert } from 'react-native';

import { useAuthStore } from '@stores/authStore';

import { handleAcceptTermsError } from '../acceptTermsError';

jest.spyOn(Alert, 'alert').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

function axiosErrorWithStatus(status: number): AxiosError {
  const err = new AxiosError('Request failed with status code ' + status);
  err.response = {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return err;
}

describe('handleAcceptTermsError', () => {
  afterEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: true });
  });

  it('swallows a 401 when the session is actually dead — the interceptor already logged out and the app routes to login', () => {
    useAuthStore.setState({ isAuthenticated: false });
    handleAcceptTermsError(axiosErrorWithStatus(401));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('surfaces a 401 when the session is still authenticated — a silent refresh-and-retry that still 401ed, not a dead session', () => {
    useAuthStore.setState({ isAuthenticated: true });
    handleAcceptTermsError(axiosErrorWithStatus(401));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Something went wrong',
      "We couldn't save that. Please check your connection and try again."
    );
  });

  it('surfaces a non-401 axios error (e.g. 500) with a generic, non-technical message', () => {
    handleAcceptTermsError(axiosErrorWithStatus(500));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Something went wrong',
      "We couldn't save that. Please check your connection and try again."
    );
  });

  it('surfaces a plain Error with a generic message, not the raw error text', () => {
    handleAcceptTermsError(new Error('Network Error'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Something went wrong',
      "We couldn't save that. Please check your connection and try again."
    );
  });

  it('surfaces a non-Error throwable with the same generic message', () => {
    handleAcceptTermsError('boom');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Something went wrong',
      "We couldn't save that. Please check your connection and try again."
    );
  });
});
