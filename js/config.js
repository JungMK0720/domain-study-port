/* Port Quiz 설정 */
window.APP_CONFIG = {
  timeAttackSeconds: 300, // 타임어택 제한 시간(초)
  quizLength: 10,         // OX / 객관식 / 주관식 문항 수
  mixedLength: 20,        // 종합 모의고사 문항 수

  leaderboard: {
    // 'local'    : 이 브라우저(localStorage)에만 저장 — 기본값, 설정 불필요
    // 'supabase' : 팀원 모두가 공유하는 온라인 랭킹 (README의 "공유 랭킹 설정" 참고)
    provider: 'supabase',
    supabase: {
      url: 'https://lkmkynpyokpfetwazgwl.supabase.co',
      // Publishable key: 브라우저 공개용 키 (RLS로 읽기·등록만 허용, 수정·삭제 불가)
      anonKey: 'sb_publishable_6EupHQvVY5EU2ch0jeYlDw_zJ3OvUsL',
      table: 'scores'
    }
  }
};
