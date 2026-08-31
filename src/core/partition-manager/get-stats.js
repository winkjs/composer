// core/partition-manager/get-stats.js

/**
 * @fileoverview Read-only statistics snapshot for the partition
 * manager. Lets an operator count dropped messages and partitions
 * instead of scraping log lines (logger-facade epic, Story 6). The
 * counter itself is initialized in init.js and maintained at the
 * drop site in update.js; this file only reads.
 */

/**
 * Build a snapshot of the partition manager's counters. Cold path:
 * allocates one small object per call and is never called per
 * message.
 *
 * @param {Object} composerState - State object created by init().
 * @returns {{droppedUnknownSpecialization: number,
 *   totalPartitionsCreated: number, activePartitions: number}}
 *   Messages dropped for an unknown specialization; partition
 *   creations attempted, accepted or cap-rejected (ADR-016); and
 *   partitions currently held.
 */
const getStats = function ( composerState ) {
    return {
        droppedUnknownSpecialization: composerState.droppedUnknownSpecialization,
        totalPartitionsCreated: composerState.totalPartitionsCreated,
        activePartitions: composerState.partitionSpecializations.size
    };
}; // getStats()

export default getStats;
