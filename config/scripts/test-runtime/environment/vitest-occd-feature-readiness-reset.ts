// A startOCCd test that fails partway must not leave latches closed: later tests in the worker would wait 10 s.
import { afterEach } from 'vitest'
import { _resetOCCdFeatureReadinessForTests } from '../../../../src/main/runtime/rpc/occd-feature-readiness'

afterEach(() => {
  _resetOCCdFeatureReadinessForTests()
})
