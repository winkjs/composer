const size = 10;
const a = new Array(size);
for (let k = 0; k < a.length; k += 1) a[k] = Math.random();

const o = Object.create( null );
for (let k = 0; k < size; k += 1) o['k' + k] = Math.random();

let sum = 0;
console.time('array Perf: ');
for (let i = 1; i < 1000000; i += 1) {
    for (let j = 0; j < a.length; j += 1) {
        sum += Math.log10(i) + a[j];
    }
}
console.timeEnd('array Perf: ');
console.log(sum);

sum = 0;
console.time('object Perf: ');
for (let i = 1; i < 1000000; i += 1) {
    // eslint-disable-next-line guard-for-in
    for (const j in o) {
        sum += Math.log10(i) + o[j];
    }
}
console.timeEnd('object Perf: ');

console.log(sum);
console.log(Object.keys(o).length);
console.log(a.length);
