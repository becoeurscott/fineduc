import { dateRequestParserContract } from '../port.contract.js'
import { FakeDateRequestParser } from './fake.js'

dateRequestParserContract(() => new FakeDateRequestParser())
