import { PatternParser } from './PatternParser'
import { W3cParser } from './W3cParser'
import { CombinedParser } from './CombinedParser'
import { JsonLinesParser } from './JsonParser'
import { DsvParser } from './DsvParser'
import { XmlLog4jParser } from './XmlLog4jParser'
import type { LogParser, ParserSpec } from './types'
import type { TsOptions } from './timestamps'

/** Build a LogParser from a spec (default: pattern with the default template). */
export function createParser(spec?: ParserSpec, tsOpts: TsOptions = {}): LogParser {
  switch (spec?.kind) {
    case 'w3c':
      return new W3cParser(spec.fields, tsOpts)
    case 'combined':
      return new CombinedParser(tsOpts)
    case 'json':
      return new JsonLinesParser(spec.keys, tsOpts)
    case 'dsv':
      return new DsvParser(spec.delimiter, spec.tsCol, spec.levelCol, tsOpts)
    case 'log4j-xml':
      return new XmlLog4jParser(tsOpts)
    case 'pattern':
      return new PatternParser({ template: spec.template, naiveAsUtc: tsOpts.naiveAsUtc })
    default:
      return new PatternParser({ naiveAsUtc: tsOpts.naiveAsUtc })
  }
}