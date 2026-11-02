export const EDUCATION_EXAMPLES = [
  {
    key: "switch",
    title: "switch · fall-through และ break",
    lang: "c" as const,
    entry: "classify",
    args: [2],
    source: `int classify(int n) {
    int score = 0;
    switch (n) {
        case 1: score = 10; break;
        case 2: score = 20;
        case 3: score += 5; break;
        default: score = -1;
    }
    return score;
}`,
  },
  {
    key: "sizeof",
    title: "sizeof · ขนาดอาร์เรย์และแถว",
    lang: "c" as const,
    entry: "matrixBytes",
    args: [],
    source: `int matrixBytes() {
    int matrix[2][3];
    int rows = sizeof(matrix) / sizeof(matrix[0]);
    int columns = sizeof(matrix[0]) / sizeof(matrix[0][0]);
    return rows * columns;
}`,
  },
  {
    key: "address",
    title: "&ตัวแปร · แก้ค่าผ่าน pointer",
    lang: "c" as const,
    entry: "demo",
    args: [],
    source: `void increment(int *p) {
    *p += 1;
}

int demo() {
    int value = 4;
    increment(&value);
    return value;
}`,
  },
  {
    key: "matrix",
    title: "อาร์เรย์ 2 มิติ · row-major",
    lang: "c" as const,
    entry: "matrixSum",
    args: [],
    source: `int sumRow(int *row, int n) {
    int sum = 0;
    for (int i = 0; i < n; i++) sum += row[i];
    return sum;
}

int matrixSum() {
    int matrix[2][3] = {{1, 2, 3}, {4, 5, 6}};
    return sumRow(matrix[1], 3);
}`,
  },
];
