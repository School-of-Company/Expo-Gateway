export class NoHealthyInstanceError extends Error {
  constructor(public readonly appName: string) {
    super(`No healthy (UP) instance found for Eureka app "${appName}"`);
    this.name = 'NoHealthyInstanceError';
  }
}

export class EurekaLookupError extends Error {
  constructor(
    public readonly appName: string,
    cause: Error,
  ) {
    super(`Eureka lookup failed for app "${appName}": ${cause.message}`);
    this.name = 'EurekaLookupError';
  }
}
