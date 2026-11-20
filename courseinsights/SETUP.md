# Course Voices — 설치 및 운영 안내

> **CampusPilot Vercel 배포** — 현재 통합 사이트의 Course Insights 강의 삭제는 Supabase가 아닌 기존 Vercel Postgres API를 사용합니다. 배포 전 Vercel 프로젝트 환경 변수 `CAMPUSPILOT_COURSE_ADMIN_PASSPHRASE`에 16자 이상인 새 무작위 비밀 문구를 설정하고 재배포하세요. 기존 부서 로그인 코드와 다른 값을 사용하고 Git이나 HTML에는 넣지 않습니다. 관리자는 `Delete course` 확인창에서 이 문구를 입력합니다. 목록에서 삭제한 강의의 후기와 신고는 DB에 유지됩니다. 아래 내용은 이전 독립형 프로토타입에만 적용됩니다.

이 버전은 CampusPilot과 연결하지 않는 독립형 교수·강의 후기 서비스입니다. 기존 사이트의 계정, 비밀번호, 관리자 코드를 사용하지 않습니다. 학생용 `index.html`과 관리자용 `admin.html`은 같은 폴더에서 서로 연결됩니다.

## 제공 파일
- `index.html`: 학생 페이지. CSS·JavaScript 내장.
- `admin.html`: 별도 관리자 페이지. CSS·JavaScript 내장.
- `schema.sql`: Supabase 데이터베이스·권한·API 설치 코드.
- `SETUP.md`: 설치 및 출시 전 확인 절차.

현재 HTML은 **디자인 미리보기**입니다. 가상 교수·샘플 평점만 표시하며 실제 후기를 저장하지 않습니다. 아래 연결 작업을 마쳐야 서비스가 동작합니다. 샘플 데이터는 DB에 들어가지 않습니다. 기존 원본 없이 빨간 배경 / 회색 본문 기준으로 새로 만든 디자인입니다.

## 1. 데이터베이스 연결
1. 전용 Supabase 프로젝트를 생성합니다. SQL Editor에서 `schema.sql` 전체를 한 번 실행합니다. 새 프로젝트용 초기 설치입니다. 이미 설치한 프로젝트에 다시 실행하지 마세요.
2. Authentication에서 이메일 로그인을 활성화합니다. 이메일 인증을 유지하고 실제 발송용 SMTP를 설정합니다. Site URL과 허용 Redirect URL에 최종 `index.html`, `admin.html` 주소를 정확하게 등록합니다. Magic Link 이메일 템플릿은 기본 링크 방식을 사용합니다.
3. 프로젝트 URL과 **publishable key 또는 anon key**를 복사합니다. 두 HTML의 `const CONFIG = { url: '', anonKey: '' };`를 모두 채웁니다. `service_role` / secret key / DB 비밀번호는 HTML에 넣지 않습니다.
4. 학생 인증 이메일은 `@utah.edu`로 제한됩니다. 서버에서도 인증 완료와 도메인을 재검증합니다. 다른 도메인으로 변경할 때 HTML 정규식과 SQL의 검증 함수를 함께 바꾸세요. 학교 이메일은 실제 수강이나 현재 재학 여부의 증명이 아닙니다. 후기는 본인의 수강 완료 확인을 기준으로 합니다.
5. `cv_private` 스키마는 Data API 노출 목록에 추가하지 않습니다. 외부 접근은 지정된 `public.cv_*` 함수만 이용합니다. private 테이블은 RLS가 켜지고 브라우저 역할에 직접 읽기/쓰기 권한이 없습니다.

## 2. 첫 관리자 지정
학교 이메일로 한 번 로그인한 뒤 Supabase SQL Editor에서 실행하세요. 아래 이메일은 실제 관리자 이메일로 바꾸세요.

```sql
insert into cv_private.admins(user_id)
select id from auth.users
where lower(email) = 'YOUR-ADMIN@utah.edu'
  and email_confirmed_at is not null
on conflict do nothing;
```

관리자 화면에서 교수·강의를 등록합니다. 같은 교수/강의 코드는 하나의 항목이며 후기는 학기별로 작성합니다. 한 강의를 여러 교수가 함께 담당하는 경우 공동 담당 이름으로 하나의 항목을 등록할 수 있습니다. 관리자 권한 회수는 SQL에서 해당 `cv_private.admins` 행을 삭제합니다. 사용자 차단은 Supabase Authentication 관리에서 수행합니다. 별도 사용자 관리 UI는 이 버전에 포함하지 않았습니다.

## 3. GitHub Pages 제출
GitHub 저장소의 배포 폴더에 위 네 파일을 같은 위치로 업로드합니다. Settings → Pages에서 배포 브랜치/폴더를 선택하고 배포 완료 후 주소를 확인합니다. 학생 주소는 `https://USERNAME.github.io/REPOSITORY/index.html`, 관리자는 동일 경로의 `admin.html`입니다. 대소문자를 유지하세요.

가람에게 HTML 두 파일과 실제 GitHub Pages 링크를 전달하세요. ZIP은 필요 없습니다. 메모: **“CSS와 JavaScript는 HTML에 내장되어 있습니다. 실제 데이터 저장은 Supabase 연결 및 schema.sql 설치가 필요합니다.”** 현재 제공된 미리보기 주소는 GitHub Pages 주소가 아닙니다. 이 작업에서 GitHub 계정에 배포하지는 않았습니다.

## 동작과 보안 경계
- 공개 읽기: 활성 강의 목록과 게시된 후기만. 작성자 UUID·이메일·신고자 정보는 반환하지 않음.
- 학교 계정: 본인 후기 작성/수정/삭제, 신고. 교수·강의·학기별 중복 제한.
- 공개 익명: 다른 학생에게 익명. DB 운영자는 계정과 연결된 작성자 정보를 접근할 수 있음.
- 후기 작성/수정 시 pending으로 저장. 검토 승인 후 평점에 반영. 숨김 시 공개 후기·평점에서 제외.
- 관리자 RPC는 매번 권한을 검사. 관리자 URL을 안다는 것만으로 권한을 얻지 못함.
- 신고/쓰기/삭제는 계정별 시간당 20회 제한. DB 트랜잭션 잠금과 감사 기록 사용.
- DOM 출력은 이스케이프 처리. 인증 세션은 sessionStorage(탭 세션)에 저장. 이메일 링크는 같은 브라우저에서 열기.
- 외부 요청: Supabase 인증/API, Google Fonts. 이미지 및 외부 JavaScript 라이브러리 없음.
- 목록: 공개 후기는 강의별 최신 500개, 관리자 검토는 한 번에 200개. 처리하면 다음 항목 표시. 대규모 운영에는 페이지네이션 추가 권장.

## 출시 전 실제 프로젝트에서 확인할 항목
이 소스만으로 서비스 출시가 검증된 것은 아닙니다. 실제 Supabase 자격 증명이 제공되지 않아 메일 발송, 실서버 RPC, 실제 사용자 권한 및 DB 마이그레이션을 이 환경에서 통합 검증하지 못했습니다.

1. 이메일 링크 로그인 성공, 만료/재로그인/로그아웃.
2. 익명·다른 도메인·학생 계정으로 관리자 RPC 거부 확인.
3. 계정 A의 후기를 계정 B가 수정/삭제하지 못하는지 확인.
4. 글 작성 → 검토대기 → 승인 → 공개·평점 반영 → 수정 시 재검토 → 숨김/삭제 시 제외.
5. 중복 학기 후기, 빈 글, 길이 초과, 평점 범위, HTML 입력, 과도한 연속 요청 처리.
6. 신고 → 관리자 처리 → 감사 로그 기록 확인.
7. 운영 주체·문의처·개인정보 보관/삭제 정책을 정하고 이용자에게 공개. 운영자의 개인정보 접근 범위를 안내문과 일치시킬 것. 자동 보관기간 삭제 작업은 미구현.
8. Supabase Auth rate limits / SMTP 발송 제한을 설정하고 실제 발송 테스트. 트래픽이 늘면 CAPTCHA 연동과 서버 모니터링 추가.
9. 백업/복구 정책과 관리자 계정 보안을 설정. 실제 학사 수강 확인 시스템과의 연동은 미구현.

참고: https://supabase.com/docs/guides/auth/auth-email-passwordless
https://supabase.com/docs/guides/database/functions
https://supabase.com/docs/guides/database/postgres/row-level-security

## 개발 소스
`app.js`, `ui.css`, `build.mjs`가 있는 소스에서는 `node build.mjs`로 독립 HTML 두 개를 다시 생성할 수 있습니다. Node.js 외 빌드 의존성은 없습니다. HTML 직접 수정 후 빌드하면 덮어써지므로 원본 app.js 설정도 함께 유지하세요.
