export class RingBuffer {
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new Error("bad capacity");
    this.capacity = capacity;
    this.arr = new Array(capacity);
    this.size = 0;
    this.head = 0;
  }

  push(x) {
    this.arr[this.head] = x;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  tail(n) {
    const take = Math.max(0, Math.min(this.size, n));
    const out = new Array(take);
    const start = (this.head - take + this.capacity) % this.capacity;
    for (let i = 0; i < take; i++) out[i] = this.arr[(start + i) % this.capacity];
    return out;
  }

  clear() {
    this.size = 0;
    this.head = 0;
    this.arr.fill(undefined);
  }
}
