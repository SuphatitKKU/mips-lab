import { describe, it, expect } from "vitest";
import { compileC } from "./compile";
import { assemble } from "../mips/assembler";
import { EDUCATION_EXAMPLES } from "./examples";
import { grade, runOnce } from "../grader";
import { PROBLEMS, type Problem } from "../../data/problems";
import { Cpu } from "../mips/cpu";

function execute(source: string, args: number[] = [], entry = "f") {
  const c = compileC(source);
  if (!c.ok) throw new Error(JSON.stringify(c.errors));
  const a = assemble(c.asm);
  if (!a.ok) throw new Error(JSON.stringify(a.errors) + "\n" + c.asm);
  const cpu = new Cpu(a.prog, {
    entry,
    regs: Object.fromEntries(args.map((v, i) => ["a" + i, v])),
    history: false,
  });
  const sp = cpu.r[29],
    saved = Array.from(cpu.r.slice(16, 24));
  expect(cpu.run(1000000)?.kind, c.asm).toBe("return");
  expect(cpu.r[29], c.asm).toBe(sp);
  expect(Array.from(cpu.r.slice(16, 24)), c.asm).toEqual(saved);
  for (const line of c.lines)
    if (line.asm && !line.asm.startsWith(".")) {
      expect(line.c).toBeGreaterThan(0);
      expect(line.ex?.length).toBeGreaterThan(0);
    }
  return cpu.r[2];
}
const cases: [string, string, number, number[]?][] = [
  [
    "sizeof promotes ternary chars",
    "int f(){return sizeof(1 ? (char)2 : (char)3);}",
    4,
  ],
  ["global char initializer truncation", "char c=300;int f(){return c;}", 44],
  [
    "global sizeof and constant initializer",
    "int m[2][3];int rowBytes=sizeof(m[0]);int n=2*3;int f(){return rowBytes+n;}",
    18,
  ],
  [
    "constant unsigned shift in case",
    "int f(){switch(2147483647){case ((unsigned)4294967295 >> 1):return 9;default:return 0;}}",
    9,
  ],
  [
    "switch first matching case",
    "int f(int n){switch(n){case 1:return 10;case 2:return 20;default:return 30;}}",
    20,
    [2],
  ],
  [
    "switch no match",
    "int f(int n){switch(n){case 1:return 10;default:return 30;}}",
    30,
    [7],
  ],
  [
    "fallthrough and stacked labels",
    "int f(int n){int s=0;switch(n){case 0:case 1:s+=2;case 2:s+=3;break;default:s=9;}return s;}",
    5,
    [1],
  ],
  [
    "default in the middle falls through",
    "int f(){int s=0;switch(8){case 1:s=1;break;default:s=4;case 3:s+=2;}return s;}",
    6,
  ],
  [
    "switch selector executes once",
    "int f(){int n=1,s=0;switch(n++){case 1:s=4;break;default:s=9;}return n*10+s;}",
    24,
  ],
  [
    "switch without default",
    "int f(){int s=3;switch(9){case 1:s=8;}return s;}",
    3,
  ],
  [
    "nested switch and loop continue",
    "int f(){int s=0;for(int i=0;i<5;i++){switch(i){case 1:continue;case 2:break;default:s+=i;}s+=10;}return s;}",
    47,
  ],
  [
    "nested switch breaks nearest construct",
    "int f(){int s=0;switch(1){case 1:s=1;switch(2){case 2:s+=3;break;}s+=5;break;default:s=99;}return s;}",
    9,
  ],
  [
    "case constant expression",
    "int f(){switch(8){case (1<<3):return 17;default:return 0;}}",
    17,
  ],
  [
    "case unsigned representation",
    "int f(){unsigned n=4294967295;switch(n){case -1:return 23;default:return 0;}}",
    23,
  ],
  [
    "sizeof scalar and pointer types",
    "int f(){return sizeof(int)+sizeof(char)+sizeof(unsigned char)+sizeof(int*)+sizeof(int**);}",
    14,
  ],
  ["sizeof character literal is int", "int f(){return sizeof('a');}", 4],
  [
    "sizeof has no increment side effect",
    "int f(){int x=9;int s=sizeof(x++);return x*10+s;}",
    94,
  ],
  [
    "sizeof has no function call side effect",
    "int g=0;int bump(){g++;return g;}int f(){int s=sizeof(bump());return g*10+s;}",
    4,
  ],
  [
    "sizeof arrays and row",
    "int f(){int a[2][3];return sizeof(a)*100+sizeof(a[0])*10+sizeof(a[0][0]);}",
    2524,
  ],
  [
    "sizeof char arrays and array type",
    "int f(){char a[5];return sizeof(a)*100+sizeof(int[2][3]);}",
    524,
  ],
  [
    "sizeof parameter array is pointer",
    "int size(int a[][3]){return sizeof(a)*100+sizeof(a[0]);}int f(){int a[2][3];return size(a);}",
    412,
  ],
  [
    "take local address and mutate in callee",
    "void inc(int*p){*p+=1;}int f(){int x=4;inc(&x);return x;}",
    5,
  ],
  [
    "addressed local stays coherent through aliases",
    "int f(){int x=2;int*p=&x;x=4;*p+=3;return x*10+*p;}",
    77,
  ],
  [
    "take parameter address",
    "void put(int*p){*p=19;}int f(int n){put(&n);return n;}",
    19,
    [3],
  ],
  [
    "pointer to pointer preserves indirection",
    "int f(){int x=2,y=8;int*p=&x;int**pp=&p;*pp=&y;**pp+=3;return x*100+y;}",
    211,
  ],
  [
    "addressed locals with same shadowed name",
    "int f(){int x=2;int*p=&x;{int x=7;int*q=&x;*q=9;}return *p;}",
    2,
  ],
  [
    "addressed locals survive nested calls",
    "void inc(int*p){*p+=1;}int twice(int*p){inc(p);inc(p);return *p;}int f(){int x=5;int y=twice(&x);return x+y;}",
    14,
  ],
  [
    "recursive frame retains independent local addresses",
    "int h(int n){int x=n;int*p=&x;if(n) x+=h(n-1);return *p;}int f(){return h(5);}",
    15,
  ],
  [
    "char address uses byte load and signed extension",
    "void put(char*p){*p=200;}int f(){char c=1;put(&c);return c;}",
    -56,
  ],
  [
    "char array uses byte stride",
    "int f(){unsigned char a[3]={1,200,7};unsigned char*p=a;p++;return *p+sizeof(a);}",
    203,
  ],
  [
    "local matrix and dynamic index",
    "int f(int i,int j){int m[2][3]={{1,2,3},{4,5,6}};m[i][j]+=10;return m[i][j]+m[0][0];}",
    16,
    [1, 1],
  ],
  [
    "partially initialized rows are zero filled",
    "int f(){int m[2][3]={{1},{4,5}};return m[0][1]+m[1][2]+m[1][0];}",
    4,
  ],
  [
    "matrix infers outer bound",
    "int f(){int m[][2]={{2,3},{5,7},{11,13}};return m[2][1]+sizeof(m);}",
    37,
  ],
  [
    "global matrix row major layout",
    "int m[2][3]={{1,2,3},{4,5,6}};int f(){m[1][2]=9;return m[0][2]+m[1][2];}",
    12,
  ],
  [
    "matrix parameter scales rows and permits writes",
    "int set(int a[][3],int r,int c){a[r][c]=15;return sizeof(a[0]);}int f(){int m[2][3]={{1,2,3},{4,5,6}};int n=set(m,1,2);return m[1][2]+n;}",
    27,
  ],
  [
    "matrix row decays to scalar pointer",
    "int sum(int*a,int n){int s=0;for(int i=0;i<n;i++)s+=a[i];return s;}int f(){int m[2][3]={{1,2,3},{4,5,6}};return sum(m[1],3);}",
    15,
  ],
  [
    "matrix pointer subtraction counts rows",
    "int f(){int a[2][3];return (&a[1]-&a[0])*sizeof(a[0]);}",
    12,
  ],
  [
    "char matrix full row size",
    "int f(){char m[2][3]={{1,2,3},{4,5,6}};return m[1][2]+sizeof(m[0])+sizeof(m);}",
    15,
  ],
  [
    "zero fill after reusing stack frame",
    "int h(int n){int a[3]={n};a[2]+=n;return a[2];}int f(){int x=h(7);return x+h(2);}",
    9,
  ],
  [
    "compound memory target index executes once",
    "int f(){int a[3]={4,8,9};int i=0;a[i++]+=3;return i*100+a[0]*10+a[1];}",
    178,
  ],
  [
    "compound store retains address through call",
    "int h(){return 3;}int f(){int a[2]={4,8};a[1]+=h();return a[1];}",
    11,
  ],
  ["scalar plus pointer", "int f(){int a[3]={2,4,8};return *(1+a);}", 4],
  [
    "sizeof type in array dimension",
    "int f(){int a[sizeof(int)];return sizeof(a);}",
    16,
  ],
];
describe("educational C extension executes on the MIPS CPU", () => {
  for (const [name, source, want, args] of cases)
    it(name, () => expect(execute(source, args)).toBe(want));
});
const invalid: [string, string][] = [
  [
    "duplicate case",
    "int f(){switch(0){case 1:return 2;case 1:return 3;}return 0;}",
  ],
  [
    "duplicate default",
    "int f(){switch(0){default:return 2;default:return 3;}}",
  ],
  [
    "case is not constant",
    "int f(int n){switch(0){case n:return 2;}return 0;}",
  ],
  ["continue without loop", "int f(){switch(1){case 1:continue;}return 0;}"],
  ["sizeof unknown unary", "int f(){return sizeof(!missing);}"],
  ["sizeof unknown cast", "int f(){return sizeof((int)missing);}"],
  ["sizeof unknown ternary", "int f(){return sizeof(1 ? 2 : missing);}"],
  ["sizeof nested unknown", "int f(){return sizeof(sizeof(missing()));}"],
  ["sizeof invalid increment", "int f(){return sizeof(1++);}"],
  [
    "sizeof invalid call args",
    "int g(int x){return x;}int f(){return sizeof(g());}",
  ],
  ["sizeof void", "int f(){return sizeof(void);}"],
  ["sizeof unknown function", "int f(){return sizeof(missing());}"],
  ["address of rvalue", "int f(){return *(&1);}"],
  ["index into integer", "int f(){int x=2;return x[0];}"],
  ["VLA", "int f(int n){int a[n];return 0;}"],
  ["zero array size", "int f(){int a[0];return 0;}"],
  ["too many dimensions", "int f(){int a[2][2][2];return 0;}"],
  ["row initializer overflow", "int f(){int a[2][2]={{1,2,3}};return 0;}"],
  ["total initializer overflow", "int f(){int a[1]={1,2};return 0;}"],
  ["array assignment", "int f(){int a[2][2];a[1]=3;return 0;}"],
  ["preprocessor directives", "\n#define N 2\nint f(){return N;}"],
  ["unterminated comment", "int f(){return 0;} /*"],
];
describe("unsupported and invalid constructs fail with a located diagnostic", () => {
  for (const [name, source] of invalid)
    it(name, () => {
      const c = compileC(source);
      expect(c.ok).toBe(false);
      if (!c.ok) {
        expect(c.errors[0].line).toBeGreaterThan(0);
        expect(c.errors[0].msg.length).toBeGreaterThan(5);
      }
    });
});

describe("user-facing examples and actual grading share the same compiler", () => {
  const expected = [25, 6, 5, 15];
  for (const [i, example] of EDUCATION_EXAMPLES.entries())
    it(example.title, () =>
      expect(
        execute(example.source, example.args as number[], example.entry),
      ).toBe(expected[i]),
    );
  it("grades flat matrix arguments and array mutations", () => {
    const source = "int f(int a[][3]){a[1][2]+=10;return a[1][2];}";
    const p: Problem = {
      ...PROBLEMS[0],
      kind: "c",
      fn: "f",
      params: [["a0", "matrix", "row-major"]],
      tests: [
        {
          args: [[1, 2, 3, 4, 5, 6]],
          expect: { v0: 16 },
          expectArr: [1, 2, 3, 4, 5, 16],
        },
      ],
    };
    expect(grade(p, source, true).passed).toBe(1);
    expect(runOnce(p, source, [[1, 2, 3, 4, 5, 6]]).outputs).toContainEqual([
      "matrix",
      "[1, 2, 3, 4, 5, 16]",
    ]);
  });
  it("grades signed char arguments using byte layout", () => {
    const source = "int f(char *a){a[1]+=1;return a[0]+a[1]+a[2];}";
    const p: Problem = {
      ...PROBLEMS[0],
      kind: "c",
      fn: "f",
      params: [["a0", "bytes", "signed chars"]],
      tests: [
        { args: [[-1, 126, 3]], expect: { v0: 129 }, expectArr: [-1, 127, 3] },
      ],
    };
    expect(grade(p, source, true).passed).toBe(1);
    expect(runOnce(p, source, [[-1, 126, 3]]).outputs).toContainEqual([
      "bytes",
      "[-1, 127, 3]",
    ]);
  });
  it("matches row-major matrix references across sizes and indices", () => {
    for (let rows = 1; rows <= 4; rows++)
      for (let cols = 1; cols <= 5; cols++) {
        const values = Array.from({ length: rows * cols }, (_, i) => i * 3 - 7);
        const source = `int f(int r,int c){int m[${rows}][${cols}]={${values.join(",")}};return m[r][c]+sizeof(m);}`;
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++)
            expect(execute(source, [r, c])).toBe(
              values[r * cols + c] + rows * cols * 4,
            );
      }
  });
});
