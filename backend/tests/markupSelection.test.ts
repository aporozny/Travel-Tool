import { pickEffectiveRule, type RouteMarkupRule } from '../src/services/markupSelection';

const globalRule: RouteMarkupRule = { id: 'g1', markup_type: 'percentage', markup_value: '0.08', min_fee: '5', max_fee: '150', scope: 'global', route_origin: null, route_destination: null };
const routeRule: RouteMarkupRule = { id: 'r1', markup_type: 'percentage', markup_value: '0.15', min_fee: null, max_fee: null, scope: 'route', route_origin: 'SYD', route_destination: 'DPS' };

describe('which markup rule applies to a route', () => {
  it('uses the route rule when one exists for exactly this origin and destination', () => {
    expect(pickEffectiveRule({ global: globalRule, route: routeRule }, { origin: 'SYD', destination: 'DPS' })).toBe(routeRule);
  });

  it('falls back to the global rule when no route was given at all (e.g. a hotel quote)', () => {
    expect(pickEffectiveRule({ global: globalRule, route: routeRule }, null)).toBe(globalRule);
  });

  it('falls back to the global rule when the route rule is for a different route entirely', () => {
    expect(pickEffectiveRule({ global: globalRule, route: routeRule }, { origin: 'MEL', destination: 'DPS' })).toBe(globalRule);
  });

  it('never applies a route rule to its reverse direction -- DPS to SYD is a different route', () => {
    expect(pickEffectiveRule({ global: globalRule, route: routeRule }, { origin: 'DPS', destination: 'SYD' })).toBe(globalRule);
  });

  it('falls back to the global rule when there simply is no route rule', () => {
    expect(pickEffectiveRule({ global: globalRule, route: null }, { origin: 'SYD', destination: 'DPS' })).toBe(globalRule);
  });

  it('returns null when neither rule exists (the caller decides that is an error)', () => {
    expect(pickEffectiveRule({ global: null, route: null }, { origin: 'SYD', destination: 'DPS' })).toBeNull();
  });

  it('returns the route rule even with no global rule on record', () => {
    expect(pickEffectiveRule({ global: null, route: routeRule }, { origin: 'SYD', destination: 'DPS' })).toBe(routeRule);
  });
});
