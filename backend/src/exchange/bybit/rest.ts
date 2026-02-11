export class BybitRestClient {
  constructor(private readonly baseUrl = process.env.BYBIT_HTTP_URL || 'https://api.bybit.com') {}
  async get(path: string) { return fetch(`${this.baseUrl}${path}`).then(r => r.json()); }
}
