/**
 * @ai-floor-planner/core
 *
 * Core domain model, types, and shared utilities for the AI Floor Planner platform.
 * This package is the foundational dependency for all other packages.
 */

export * from './types/index';
export * from './models/index';
export * from './editor/index';
export * from './constants';
export * from './capabilities';
export * from './architectural-review';
export * from './types/building-budget';
export * from './models/building-budget';
export * from './models/reviewed-generation';
export * from './models/canonical-revision';

export * from './compliance/udcpr-residential-types';
export * from './compliance/vastu-advisory-types';
export * from './mep/mep-contracts';
export * from './mep/mep-validation';
