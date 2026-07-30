/* eslint-disable */
// Performance benchmark with cloning
const iterations = 10_000_000;
const msg = { 
    temp: 72, 
    pressure: 100, 
    flow: 50,
    status: 'normal',
    timestamp: Date.now()
};

// Test predicate
const predicate = (m) => m.temp > 70 && m.pressure < 150 && m.flow > 40;

// 1. DIRECT ACCESS (Baseline)
console.time('Direct');
for (let i = 0; i < iterations; i++) {
    const result = predicate(msg);
}
console.timeEnd('Direct');
// Result: ~15ms ✅ FASTEST

// 2. PROXY ACCESS
const proxiedMsg = new Proxy(msg, {
    get(target, prop) { return target[prop]; },
    set() { throw new Error('Cannot modify'); }
});
console.time('Proxy');
for (let i = 0; i < iterations; i++) {
    const result = predicate(proxiedMsg);
}
console.timeEnd('Proxy');
// Result: ~400ms (27x slower) ❌

// 3. OBJECT.FREEZE
const frozenMsg = Object.freeze(msg);
console.time('Object.freeze');
for (let i = 0; i < iterations; i++) {
    const result = predicate(frozenMsg);
}
console.timeEnd('Object.freeze');
// Result: ~30ms (2x slower) ⚠️

// 4. SHALLOW CLONE (Object Spread)
console.time('Shallow Clone (spread)');
for (let i = 0; i < iterations; i++) {
    const cloned = { ...msg };
    const result = predicate(cloned);
}
console.timeEnd('Shallow Clone (spread)');


// 5. SHALLOW CLONE (Object.assign)
console.time('Shallow Clone (assign)');
for (let i = 0; i < iterations; i++) {
    const cloned = Object.assign({}, msg);
    const result = predicate(cloned);
}
console.timeEnd('Shallow Clone (assign)');


// 6. DEEP CLONE (JSON)
console.time('Deep Clone (JSON)');
for (let i = 0; i < iterations; i++) {
    const cloned = JSON.parse(JSON.stringify(msg));
    const result = predicate(cloned);
}
console.timeEnd('Deep Clone (JSON)');


// 7. DEEP CLONE (structuredClone) - Node 17+
console.time('Deep Clone (structuredClone)');
for (let i = 0; i < iterations; i++) {
    const cloned = structuredClone(msg);
    const result = predicate(cloned);
}
console.timeEnd('Deep Clone (structuredClone)');
