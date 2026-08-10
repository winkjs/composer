/**
 * @fileoverview A complete winkComposer flow in one file. It replays a
 * CSV feed of pump motor temperatures and cleans each reading. It
 * flags when the motor runs hot, confirms the heat is not a blip, and
 * prints an alert to the terminal.
 *
 * Run it with: npm install && npm start
 * The same flow appears in the repository README's Quick Start.
 */

import { flow, csv, terminal } from '@winkjs/composer';

const handle = await flow( 'hello-flow' )

    // Replay the CSV like a live feed: one reading every 200 ms.
    .source( csv, { path: 'data/pump-temps.csv', delayMs: 200 } )

    // Alerts print to the terminal here. A production flow points this
    // at an MQTT broker instead, with QuestDB for storage.
    .emitter( terminal, { verbose: true, prefix: '[pump]' } )

    // One isolated pipeline per pump, and alerts name the pump in
    // their topic. This feed has a single pump; a fleet needs no
    // code change.
    .assetId( 'id' )

    // 1. clean — reject readings outside a sane range
    .sanitize( 'clean', 'motor_t',
        { failureReason: 'reject_reason' },
        { ranges: { min: 0, max: 120 } } )

    // 2. detect — flag when the motor runs hot
    .threshold( 'tooHot', 'motor_t',
        { active: 'is_hot' },
        { mode: 'above', threshold: 80, hysteresis: 3 } )

    // 3. confirm — hot across several readings, not one spike
    .persistenceCheck( 'confirmHot',
        ( msg ) => msg.is_hot,
        { persistenceConfirmed: 'hot_confirmed' },
        { minVotes: 3, outOfTotal: 5 } )

    // 4. broadcast — print an alert once confirmed
    .emitIf( 'alert',
        ( msg ) => msg.hot_confirmed,
        { target: 'terminal', insightType: 'overheat' } )

    .run();

console.log( `\nFlow running: ${handle.flowName}` );
console.log( 'Replaying one reading every 200 ms — deliberately paced, not slow. Watch for the overheat alerts.\n' );
