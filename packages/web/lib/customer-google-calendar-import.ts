import type { ApiResponse } from '../../shared/src/types/api';
import { customerApi } from './customer-api';

export interface CustomerClaimRequestInput {
  entryToken: string;
  email: string;
  next?: string;
}

export interface CustomerClaimRequestResult {
  message: 'claim_email_sent';
}

export function requestCustomerClaimEmail(
  input: CustomerClaimRequestInput,
): Promise<ApiResponse<CustomerClaimRequestResult>> {
  return customerApi.post<ApiResponse<CustomerClaimRequestResult>>('/api/auth/claim/request', input);
}
