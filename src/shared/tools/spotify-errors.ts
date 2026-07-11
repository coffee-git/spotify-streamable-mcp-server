export type SafeSpotifyError = {
  message: string;
  code: 'unauthorized' | 'forbidden' | 'rate_limited' | 'bad_response';
};

export function toSafeSpotifyError(error: unknown): SafeSpotifyError {
  const status = (error as { status?: number })?.status;
  if (status === 401) {
    return { code: 'unauthorized', message: 'Spotify authentication expired. Reconnect the app and retry.' };
  }
  if (status === 403) {
    return { code: 'forbidden', message: 'Spotify denied this operation. Check scopes, ownership, and Premium requirements.' };
  }
  if (status === 429) {
    return { code: 'rate_limited', message: 'Spotify rate limit reached. Retry later.' };
  }
  return { code: 'bad_response', message: 'Spotify request failed. Check server logs for details.' };
}
