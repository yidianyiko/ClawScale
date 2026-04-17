import { createCustomerApiClient, CustomerApiConfigurationError, getCustomerApiBase } from './customer-api';
import { getCokeUserToken } from './coke-user-auth';

export const CokeUserApiConfigurationError = CustomerApiConfigurationError;

export function getCokeUserApiBase(): string {
  return getCustomerApiBase();
}

export const cokeUserApi = createCustomerApiClient(getCokeUserToken);
