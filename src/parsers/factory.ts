import { PatternParser, DEFAULT_TEMPLATE } from './PatternParser'
import { W3cParser } from './W3cParser'
import { CombinedParser } from './CombinedParser'
import { JsonLinesParser } from './JsonParser'
import { DsvParser } from './DsvParser'
import { XmlLog4jParser } from './XmlLog4jParser'
import type { LogParser, ParserSpec } from './types'

/** Build a LogParser from a spec (default: pattern with the default template). */
export function createParser(spec?: ParserSpec): LogParser {
  switch (spec?.kind) {
    case 'w3c':
      return new W3cParser(spec.fields)
    case 'combined':
      return new CombinedParser()
    case 'json':
      return new JsonLinesParser(spec.keys)
    case 'dsv':
      return new DsvParser(spec.delimiter, spec.tsCol, spec.levelCol)
    case 'log4j-xml':
      return new XmlLog4jParser()
    case 'pattern':
      return new PatternParser({ template: spec.template })
    default:
      return new PatternParser({ template: DEFAULT_TEMPLATE })
  }
}