export interface ProductActionAvailability<
  Action extends string = string,
  Reason extends string = string,
> {
  allowedActions: Action[];
  blockedReasons: Reason[];
  recommendedNextAction?: Action;
}
