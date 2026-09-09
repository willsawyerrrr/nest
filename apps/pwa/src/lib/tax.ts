/**
 * The household tax row-shaping — mapping raw database rows into `@nest/tax`
 * engine inputs and running the estimate. The implementation lives in
 * `@nest/household`, shared with the edge functions; the PWA hook row types are
 * a structural superset of its loose row interfaces, so they pass straight in.
 */

export * from '@nest/household'
