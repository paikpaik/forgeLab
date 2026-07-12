# node-forge 버그 — `exports`의 `require` 조건이 존재하지 않는 `.cjs` 파일을 가리킴 (전체 서브패스 영향, HIGH)

## 계기

`services/waiting-room`(NestJS, `tsc`로 CommonJS 빌드)를 `@paikpaik/node-forge@1.0.0`을 실제
GitHub Packages 설치본으로 붙여서 Docker로 기동하자마자 컨테이너가 즉시 크래시했다.

```
Error: Cannot find module '/app/node_modules/@paikpaik/node-forge/dist/response/nestjs/index.cjs'
    at Object.<anonymous> (/app/dist/main.js:6:18)
  code: 'MODULE_NOT_FOUND'
```

## 현재 한계 (버그)

`package.json`의 `exports` 필드는 **모든** 서브패스(`.`, `./core`, `./response`, `./response/nestjs`
… 전부)에서 아래 패턴을 쓴다:

```json
{
  "types": "./dist/response/nestjs/index.d.ts",
  "import": "./dist/response/nestjs/index.js",
  "require": "./dist/response/nestjs/index.cjs"
}
```

그런데 `tsup.config.ts`는 `format: ['cjs', 'esm']`이고 패키지 `package.json`에
`"type": "module"`이 없다 — 이 조합에서 tsup은 CJS를 `.js`, ESM을 `.mjs`로 출력한다.
실제 `dist/`를 확인하면:

```
dist/index.js     ← "use strict" CJS 코드
dist/index.mjs    ← ESM 코드
dist/index.cjs    ← 존재하지 않음
```

즉 `exports`의 `require` 조건은 애초에 존재한 적 없는 파일(`.cjs`)을 가리키고, `import` 조건은
`.js`(사실은 CJS 포맷)를 가리켜 확장자와 실제 포맷이 반대로 매핑돼 있다.

**영향 범위**: `require()`/`tsc` CommonJS 빌드로 쓰는 모든 소비자(일반적인 NestJS `tsc` 빌드
포함)가 **패키지의 어떤 서브패스를 import해도 100% 실패**한다. 순수 ESM(`"type": "module"`,
`import` 구문)으로 쓰는 프로젝트만 우연히 동작한다 — Node의 ESM 로더가 CJS 콘텐츠를
`import`로 읽어도 interop이 되기 때문이다. 사실상 이번 패키지를 CJS로 소비할 수 있는 방법이
없다.

## 제안

둘 중 하나로 고치면 된다 (실제 산출물과 `exports` 맵을 일치시키는 게 핵심):

**(A) `exports` 맵을 tsup의 실제 출력 확장자에 맞춘다** — `require: "*.js"`, `import: "*.mjs"`로
전부 수정. 가장 적은 변경.

**(B) tsup이 명시적으로 `.cjs`/`.mjs`를 출력하도록 설정한다** (`outExtension` 콜백 사용)해서
`exports` 맵의 현재 표기(`.cjs`/`.js`)를 그대로 유지. `package.json`에 `"type": "module"`을
추가하는 조합도 고려 가능하지만, 그러면 `core` 등 프레임워크 무관 모듈까지 ESM 전용이 되어
버리므로 (A)가 더 안전해 보인다.

어느 쪽이든 퍼블리시 전에 **실제로 별도 프로젝트에서 `npm install`하고 `require()`로
서브패스를 로드해보는 스모크 테스트**를 CI에 추가하는 걸 권한다 — `vitest`가 소스를 직접
테스트하기 때문에 이번처럼 "빌드 산출물과 exports 맵의 불일치"는 기존 테스트로 잡히지 않는다.

## 검증 포인트

- `npm pack`으로 tarball을 만들어 별도 디렉토리에 설치한 뒤 `node -e "require('@paikpaik/node-forge/response/nestjs')"`가 에러 없이 로드되는지
- 같은 방식으로 ESM `import`도 재확인 (현재는 우연히 동작하지만, 수정 후에도 깨지지 않아야 함)

## 상태

`services/waiting-room` Docker 기동 검증이 이 버그로 막혀 있다. 수정 후 재배포(`git tag` push)
되면 forge-lab 쪽에서 버전을 올리고 재검증할 예정.
