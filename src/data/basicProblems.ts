// Adapted from origin/main content/problems/mips; source: SuphatitKKU/mips-lab.
import type { Problem } from "./problems";
export const BASIC_PROBLEMS: Problem[] = [
  {
    id: 14,
    title: "บวกเลขสองจำนวน",
    sub: "นำมาจากคลังโจทย์ main ของ SuphatitKKU/mips-lab",
    kind: "mips",
    level: "ง่าย",
    topic: "arithmetic",
    statement: "บวกเลขสองจำนวน รับค่าทาง $a0–$a3 และคืนผลทาง $v0",
    fn: "main",
    params: [
      ["a0", "a", "จำนวนเต็ม"],
      ["a1", "b", "จำนวนเต็ม"],
    ],
    returns: [["v0", "ผลลัพธ์"]],
    starter: "main:\n li $v0, 0\n jr $ra",
    tests: [
      {
        args: [2, 3],
        expect: {
          v0: 5,
        },
        hidden: false,
      },
      {
        args: [-4, 9],
        expect: {
          v0: 5,
        },
        hidden: false,
      },
      {
        args: [0, 0],
        expect: {
          v0: 0,
        },
        hidden: true,
      },
    ],
    answer: {
      code: [
        {
          lang: "c",
          lines: ["int main(int a, int b) { return a + b; }"],
        },
        {
          lang: "mips",
          lines: ["main:", "addu $v0, $a0, $a1", " jr $ra"],
        },
      ],
    },
    hints: ["พิจารณาค่าศูนย์และจำนวนลบ และจบฟังก์ชันด้วย jr $ra"],
    example: "",
  },
  {
    id: 15,
    title: "ลบเลขสองจำนวน",
    sub: "นำมาจากคลังโจทย์ main ของ SuphatitKKU/mips-lab",
    kind: "mips",
    level: "ง่าย",
    topic: "arithmetic",
    statement: "ลบเลขสองจำนวน รับค่าทาง $a0–$a3 และคืนผลทาง $v0",
    fn: "main",
    params: [
      ["a0", "a", "จำนวนเต็ม"],
      ["a1", "b", "จำนวนเต็ม"],
    ],
    returns: [["v0", "ผลลัพธ์"]],
    starter: "main:\n li $v0, 0\n jr $ra",
    tests: [
      {
        args: [9, 4],
        expect: {
          v0: 5,
        },
        hidden: false,
      },
      {
        args: [-3, 7],
        expect: {
          v0: -10,
        },
        hidden: false,
      },
      {
        args: [0, 0],
        expect: {
          v0: 0,
        },
        hidden: true,
      },
    ],
    answer: {
      code: [
        {
          lang: "c",
          lines: ["int main(int a, int b) { return a - b; }"],
        },
        {
          lang: "mips",
          lines: ["main:", "subu $v0, $a0, $a1", " jr $ra"],
        },
      ],
    },
    hints: ["พิจารณาค่าศูนย์และจำนวนลบ และจบฟังก์ชันด้วย jr $ra"],
    example: "",
  },
  {
    id: 16,
    title: "เลขคู่หรือเลขคี่",
    sub: "นำมาจากคลังโจทย์ main ของ SuphatitKKU/mips-lab",
    kind: "mips",
    level: "ง่าย",
    topic: "logic",
    statement: "เลขคู่หรือเลขคี่ รับค่าทาง $a0–$a3 และคืนผลทาง $v0",
    fn: "main",
    params: [["a0", "a", "จำนวนเต็ม"]],
    returns: [["v0", "ผลลัพธ์"]],
    starter: "main:\n li $v0, 0\n jr $ra",
    tests: [
      {
        args: [6],
        expect: {
          v0: 0,
        },
        hidden: false,
      },
      {
        args: [7],
        expect: {
          v0: 1,
        },
        hidden: false,
      },
      {
        args: [-3],
        expect: {
          v0: 1,
        },
        hidden: true,
      },
    ],
    answer: {
      code: [
        {
          lang: "c",
          lines: ["int main(int n) { return (n % 2 + 2) % 2; }"],
        },
        {
          lang: "mips",
          lines: ["main:", "andi $v0, $a0, 1", " jr $ra"],
        },
      ],
    },
    hints: ["พิจารณาค่าศูนย์และจำนวนลบ และจบฟังก์ชันด้วย jr $ra"],
    example: "",
  },
  {
    id: 17,
    title: "ยกกำลังสอง",
    sub: "นำมาจากคลังโจทย์ main ของ SuphatitKKU/mips-lab",
    kind: "mips",
    level: "ง่าย",
    topic: "hi-lo",
    statement: "ยกกำลังสอง รับค่าทาง $a0–$a3 และคืนผลทาง $v0",
    fn: "main",
    params: [["a0", "a", "จำนวนเต็ม"]],
    returns: [["v0", "ผลลัพธ์"]],
    starter: "main:\n li $v0, 0\n jr $ra",
    tests: [
      {
        args: [3],
        expect: {
          v0: 9,
        },
        hidden: false,
      },
      {
        args: [-4],
        expect: {
          v0: 16,
        },
        hidden: false,
      },
      {
        args: [0],
        expect: {
          v0: 0,
        },
        hidden: true,
      },
    ],
    answer: {
      code: [
        {
          lang: "c",
          lines: ["int main(int n) { return n * n; }"],
        },
        {
          lang: "mips",
          lines: ["main:", "mult $a0, $a0", "mflo $v0", " jr $ra"],
        },
      ],
    },
    hints: ["พิจารณาค่าศูนย์และจำนวนลบ และจบฟังก์ชันด้วย jr $ra"],
    example: "",
  },
  {
    id: 18,
    title: "หาค่ามากกว่า",
    sub: "นำมาจากคลังโจทย์ main ของ SuphatitKKU/mips-lab",
    kind: "mips",
    level: "ง่าย",
    topic: "branch",
    statement: "หาค่ามากกว่า รับค่าทาง $a0–$a3 และคืนผลทาง $v0",
    fn: "main",
    params: [
      ["a0", "a", "จำนวนเต็ม"],
      ["a1", "b", "จำนวนเต็ม"],
    ],
    returns: [["v0", "ผลลัพธ์"]],
    starter: "main:\n li $v0, 0\n jr $ra",
    tests: [
      {
        args: [3, 8],
        expect: {
          v0: 8,
        },
        hidden: false,
      },
      {
        args: [10, -2],
        expect: {
          v0: 10,
        },
        hidden: false,
      },
      {
        args: [5, 5],
        expect: {
          v0: 5,
        },
        hidden: true,
      },
    ],
    answer: {
      code: [
        {
          lang: "c",
          lines: ["int main(int a, int b) { if (a > b) return a; return b; }"],
        },
        {
          lang: "mips",
          lines: [
            "main:",
            "slt $t0, $a0, $a1",
            "bne $t0, $zero, second",
            "move $v0, $a0",
            "j end",
            "second: move $v0, $a1",
            "end: nop",
            " jr $ra",
          ],
        },
      ],
    },
    hints: ["พิจารณาค่าศูนย์และจำนวนลบ และจบฟังก์ชันด้วย jr $ra"],
    example: "",
  },
  {
    id: 19,
    title: "หาค่าน้อยกว่า",
    sub: "นำมาจากคลังโจทย์ main ของ SuphatitKKU/mips-lab",
    kind: "mips",
    level: "ง่าย",
    topic: "branch",
    statement: "หาค่าน้อยกว่า รับค่าทาง $a0–$a3 และคืนผลทาง $v0",
    fn: "main",
    params: [
      ["a0", "a", "จำนวนเต็ม"],
      ["a1", "b", "จำนวนเต็ม"],
    ],
    returns: [["v0", "ผลลัพธ์"]],
    starter: "main:\n li $v0, 0\n jr $ra",
    tests: [
      {
        args: [3, 8],
        expect: {
          v0: 3,
        },
        hidden: false,
      },
      {
        args: [10, -2],
        expect: {
          v0: -2,
        },
        hidden: false,
      },
      {
        args: [5, 5],
        expect: {
          v0: 5,
        },
        hidden: true,
      },
    ],
    answer: {
      code: [
        {
          lang: "c",
          lines: ["int main(int a, int b) { if (a < b) return a; return b; }"],
        },
        {
          lang: "mips",
          lines: [
            "main:",
            "slt $t0, $a0, $a1",
            "bne $t0, $zero, first",
            "move $v0, $a1",
            "j end",
            "first: move $v0, $a0",
            "end: nop",
            " jr $ra",
          ],
        },
      ],
    },
    hints: ["พิจารณาค่าศูนย์และจำนวนลบ และจบฟังก์ชันด้วย jr $ra"],
    example: "",
  },
  {
    id: 20,
    title: "ค่าสัมบูรณ์",
    sub: "นำมาจากคลังโจทย์ main ของ SuphatitKKU/mips-lab",
    kind: "mips",
    level: "ง่าย",
    topic: "branch",
    statement: "ค่าสัมบูรณ์ รับค่าทาง $a0–$a3 และคืนผลทาง $v0",
    fn: "main",
    params: [["a0", "a", "จำนวนเต็ม"]],
    returns: [["v0", "ผลลัพธ์"]],
    starter: "main:\n li $v0, 0\n jr $ra",
    tests: [
      {
        args: [-7],
        expect: {
          v0: 7,
        },
        hidden: false,
      },
      {
        args: [12],
        expect: {
          v0: 12,
        },
        hidden: false,
      },
      {
        args: [0],
        expect: {
          v0: 0,
        },
        hidden: true,
      },
    ],
    answer: {
      code: [
        {
          lang: "c",
          lines: ["int main(int n) { if (n < 0) return -n; return n; }"],
        },
        {
          lang: "mips",
          lines: [
            "main:",
            "move $v0, $a0",
            "slt $t0, $a0, $zero",
            "beq $t0, $zero, end",
            "subu $v0, $zero, $a0",
            "end: nop",
            " jr $ra",
          ],
        },
      ],
    },
    hints: ["พิจารณาค่าศูนย์และจำนวนลบ และจบฟังก์ชันด้วย jr $ra"],
    example: "",
  },
  {
    id: 21,
    title: "เครื่องหมายของจำนวน",
    sub: "นำมาจากคลังโจทย์ main ของ SuphatitKKU/mips-lab",
    kind: "mips",
    level: "กลาง",
    topic: "branch",
    statement: "เครื่องหมายของจำนวน รับค่าทาง $a0–$a3 และคืนผลทาง $v0",
    fn: "main",
    params: [["a0", "a", "จำนวนเต็ม"]],
    returns: [["v0", "ผลลัพธ์"]],
    starter: "main:\n li $v0, 0\n jr $ra",
    tests: [
      {
        args: [-9],
        expect: {
          v0: -1,
        },
        hidden: false,
      },
      {
        args: [0],
        expect: {
          v0: 0,
        },
        hidden: false,
      },
      {
        args: [8],
        expect: {
          v0: 1,
        },
        hidden: true,
      },
    ],
    answer: {
      code: [
        {
          lang: "c",
          lines: [
            "int main(int n) { if (n < 0) return -1; if (n > 0) return 1; return 0; }",
          ],
        },
        {
          lang: "mips",
          lines: [
            "main:",
            "slt $t0, $a0, $zero",
            "bne $t0, $zero, negative",
            "slt $t0, $zero, $a0",
            "bne $t0, $zero, positive",
            "li $v0, 0",
            "j end",
            "negative: li $v0, -1",
            "j end",
            "positive: li $v0, 1",
            "end: nop",
            " jr $ra",
          ],
        },
      ],
    },
    hints: ["พิจารณาค่าศูนย์และจำนวนลบ และจบฟังก์ชันด้วย jr $ra"],
    example: "",
  },
  {
    id: 22,
    title: "จำกัดค่าให้อยู่ในช่วง 0 ถึง 10",
    sub: "นำมาจากคลังโจทย์ main ของ SuphatitKKU/mips-lab",
    kind: "mips",
    level: "กลาง",
    topic: "branch",
    statement:
      "จำกัดค่าให้อยู่ในช่วง 0 ถึง 10 รับค่าทาง $a0–$a3 และคืนผลทาง $v0",
    fn: "main",
    params: [["a0", "a", "จำนวนเต็ม"]],
    returns: [["v0", "ผลลัพธ์"]],
    starter: "main:\n li $v0, 0\n jr $ra",
    tests: [
      {
        args: [-5],
        expect: {
          v0: 0,
        },
        hidden: false,
      },
      {
        args: [7],
        expect: {
          v0: 7,
        },
        hidden: false,
      },
      {
        args: [15],
        expect: {
          v0: 10,
        },
        hidden: true,
      },
    ],
    answer: {
      code: [
        {
          lang: "c",
          lines: [
            "int main(int n) { if(n<0)return 0; if(n>10)return 10; return n; }",
          ],
        },
        {
          lang: "mips",
          lines: [
            "main:",
            "slt $t0, $a0, $zero",
            "bne $t0, $zero, low",
            "li $t1, 10",
            "slt $t0, $t1, $a0",
            "bne $t0, $zero, high",
            "move $v0, $a0",
            "j end",
            "low: li $v0, 0",
            "j end",
            "high: li $v0, 10",
            "end: nop",
            " jr $ra",
          ],
        },
      ],
    },
    hints: ["พิจารณาค่าศูนย์และจำนวนลบ และจบฟังก์ชันด้วย jr $ra"],
    example: "",
  },
  {
    id: 23,
    title: "สองยกกำลัง N",
    sub: "นำมาจากคลังโจทย์ main ของ SuphatitKKU/mips-lab",
    kind: "mips",
    level: "กลาง",
    topic: "shift",
    statement: "สองยกกำลัง N รับค่าทาง $a0–$a3 และคืนผลทาง $v0",
    fn: "main",
    params: [["a0", "a", "จำนวนเต็ม"]],
    returns: [["v0", "ผลลัพธ์"]],
    starter: "main:\n li $v0, 0\n jr $ra",
    tests: [
      {
        args: [0],
        expect: {
          v0: 1,
        },
        hidden: false,
      },
      {
        args: [5],
        expect: {
          v0: 32,
        },
        hidden: false,
      },
      {
        args: [10],
        expect: {
          v0: 1024,
        },
        hidden: true,
      },
    ],
    answer: {
      code: [
        {
          lang: "c",
          lines: [
            "int main(int n) { int x=1; for(int i=0;i<n;i++) x=x*2; return x; }",
          ],
        },
        {
          lang: "mips",
          lines: [
            "main:",
            "li $v0, 1",
            "li $t0, 0",
            "loop: slt $t1, $t0, $a0",
            "beq $t1, $zero, end",
            "sll $v0, $v0, 1",
            "addiu $t0, $t0, 1",
            "j loop",
            "end: nop",
            " jr $ra",
          ],
        },
      ],
    },
    hints: ["พิจารณาค่าศูนย์และจำนวนลบ และจบฟังก์ชันด้วย jr $ra"],
    example: "",
  },
  {
    id: 24,
    title: "หาตัวหารร่วมมาก",
    sub: "นำมาจากคลังโจทย์ main ของ SuphatitKKU/mips-lab",
    kind: "mips",
    level: "กลาง",
    topic: "hi-lo",
    statement: "หาตัวหารร่วมมาก รับค่าทาง $a0–$a3 และคืนผลทาง $v0",
    fn: "main",
    params: [
      ["a0", "a", "จำนวนเต็ม"],
      ["a1", "b", "จำนวนเต็ม"],
    ],
    returns: [["v0", "ผลลัพธ์"]],
    starter: "main:\n li $v0, 0\n jr $ra",
    tests: [
      {
        args: [12, 18],
        expect: {
          v0: 6,
        },
        hidden: false,
      },
      {
        args: [13, 7],
        expect: {
          v0: 1,
        },
        hidden: false,
      },
      {
        args: [21, 0],
        expect: {
          v0: 21,
        },
        hidden: true,
      },
    ],
    answer: {
      code: [
        {
          lang: "c",
          lines: [
            "int main(int a, int b) { while(b != 0){ int t=a%b; a=b; b=t; } return a; }",
          ],
        },
        {
          lang: "mips",
          lines: [
            "main:",
            "move $t0, $a0",
            "move $t1, $a1",
            "loop: beq $t1, $zero, end",
            "div $t0, $t1",
            "mfhi $t2",
            "move $t0, $t1",
            "move $t1, $t2",
            "j loop",
            "end: move $v0, $t0",
            " jr $ra",
          ],
        },
      ],
    },
    hints: ["พิจารณาค่าศูนย์และจำนวนลบ และจบฟังก์ชันด้วย jr $ra"],
    example: "",
  },
];
