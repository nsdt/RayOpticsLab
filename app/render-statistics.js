// Per-image diagnostics. Counts are summed; residuals and error estimates retain
// their worst value. These fields are also part of exported render records.
(function (root) {
  'use strict';
  function create() {
    return {
      ok: 0,
      tir: 0,
      'no-mode': 0,
      limit: 0,
      error: 0,
      drift: 0,
      branches: 0,
      internalBranches: 0,
      maxInternalDepth: 0,
      unavailableWeight: 0,
      leaves: 0,
      maxDepth: 0,
      weightError: 0,
      dropped: 0,
      maxDropped: 0,
      failedWeight: 0,
      fluxError: 0,
      boundaryResidual: 0,
      fieldResidual: 0,
      rootResidual: 0,
      interfaces: 0,
      reflections: 0,
      bulkSteps: 0,
      bulkSegments: 0,
      layerSegments: 0,
      layerLimitWeight: 0,
      workLimitWeight: 0,
      modalClosed: 0,
      modalQuadrature: 0,
      modalWeightError: 0,
      modalQuadratureError: 0,
      errorMessage: '',
    };
  }
  function collectBudget(stats, result, config) {
    if (config.transport !== 'polarized') return;
    Optics.polarization.finishTraceBudget(config, result);
    stats.budgetPixels = (stats.budgetPixels || 0) + 1;
    stats.overBudgetPixels = (stats.overBudgetPixels || 0) + (result.withinTolerance ? 0 : 1);
    stats.unresolvedWeight = (stats.unresolvedWeight || 0) + result.unresolvedWeight;
    stats.maxUnresolvedWeight = Math.max(stats.maxUnresolvedWeight || 0, result.unresolvedWeight);
    stats.processedRays = (stats.processedRays || 0) + result.processedRays;
    stats.maxProcessedRays = Math.max(stats.maxProcessedRays || 0, result.processedRays);
    stats.maxPendingRays = Math.max(stats.maxPendingRays || 0, result.maxPendingRays);
    stats.cutoffAccountingError = Math.max(
      stats.cutoffAccountingError || 0,
      result.cutoffAccountingError,
    );
    stats.cutoffWeights ??= { threshold: 0, work: 0, interface: 0, internal: 0, tolerance: 0 };
    for (const key of Object.keys(stats.cutoffWeights))
      stats.cutoffWeights[key] += result.cutoffWeights[key];
    if (result.interfaces > 0) {
      stats.hitPixels = (stats.hitPixels || 0) + 1;
      stats.hitDropped = (stats.hitDropped || 0) + (result.dropped || 0);
      stats.hitUnresolved = (stats.hitUnresolved || 0) + result.unresolvedWeight;
    }
  }

  function collect(stats, result, config) {
    collectBudget(stats, result, config);
    for (const key of [
      'phaseClosed',
      'phaseNumerical',
      'phaseSurfaceDephasings',
      'phaseSurfaceRetentions',
      'phasePathCacheHits',
      'phaseTransmitted',
      'phaseReflected',
      'phaseUntracedReflection',
      'phaseAdiabaticSegments',
      'phaseAdiabaticWeight',
      'phaseBoundaryProjections',
      'phaseBoundaryTails',
      'phaseReentries',
      'phaseEscapedDirect',
      'phaseEscapedReflected',
    ])
      stats[key] = (stats[key] || 0) + (result[key] || 0);
    stats.phaseMinOverlap = Math.min(stats.phaseMinOverlap ?? 1, result.phaseMinOverlap ?? 1);
    for (const key of ['phaseIntegrationError', 'phaseSurfaceCoherence', 'geometryResidual'])
      stats[key] = Math.max(stats[key] || 0, result[key] || 0);
    stats.coherentSegments = (stats.coherentSegments || 0) + (result.coherentSegments || 0);
    stats.coherentSplits = (stats.coherentSplits || 0) + (result.coherentSplits || 0);
    stats.coherentLimitWeight =
      (stats.coherentLimitWeight || 0) + (result.coherentLimitWeight || 0);
    stats.coherencyError = Math.max(stats.coherencyError || 0, result.coherencyError || 0);
    stats.modalClosed += result.modalClosed || 0;
    stats.modalQuadrature += result.modalQuadrature || 0;
    stats.modalWeightError = Math.max(stats.modalWeightError, result.modalWeightError || 0);
    stats.modalQuadratureError = Math.max(
      stats.modalQuadratureError,
      result.modalQuadratureError || 0,
    );
    stats.workLimitWeight += result.workLimitWeight || 0;
    stats.layerSegments += result.layerSegments || 0;
    stats.layerLimitWeight += result.layerLimitWeight || 0;
    stats.internalBranches += result.internalBranches || 0;
    stats.maxInternalDepth = Math.max(stats.maxInternalDepth, result.maxInternalDepth || 0);
    stats.unavailableWeight += result.unavailableWeight || 0;
    stats.bulkSteps += result.bulkSteps || 0;
    stats.bulkSegments += result.bulkSegments || 0;
    if (result.message && !stats.errorMessage) stats.errorMessage = result.message;
    stats.dropped += result.dropped || 0;
    stats.maxDropped = Math.max(stats.maxDropped, result.dropped || 0);
    stats.failedWeight += result.failedWeight || 0;
    stats.fieldResidual = Math.max(stats.fieldResidual, result.fieldResidual || 0);
    stats.rootResidual = Math.max(stats.rootResidual, result.rootResidual || 0);
    stats.fluxError = Math.max(stats.fluxError, result.fluxError || 0);
    stats.boundaryResidual = Math.max(stats.boundaryResidual, result.boundaryResidual || 0);
    stats.interfaces += result.interfaces || 0;
    stats.reflections += result.reflections || 0;
    stats.branches += result.branches || 0;
    stats.leaves += result.leaves || 1;
    stats.maxDepth = Math.max(stats.maxDepth, result.maxDepth || 0);
    stats.weightError = Math.max(
      stats.weightError,
      Math.abs((result.accounted ?? result.weightSum ?? 1) - 1),
    );
    stats[result.status]++;
    stats.drift = Math.max(stats.drift, result.drift);
  }
  root.RenderStatistics = { create, collect };
})(globalThis);
