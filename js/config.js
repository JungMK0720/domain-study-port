/* Port Quiz 설정 */
window.APP_CONFIG = {
  timeAttackSeconds: 300, // 타임어택 제한 시간(초)
  quizLength: 10,         // OX / 객관식 / 주관식 문항 수
  mixedLength: 20,        // 종합 모의고사 문항 수

  leaderboard: {
    // 'local'    : 이 브라우저(localStorage)에만 저장 — 기본값, 설정 불필요
    // 'supabase' : 팀원 모두가 공유하는 온라인 랭킹 (README의 "공유 랭킹 설정" 참고)
    provider: 'local',
    supabase: {
      url: '',      // 예: 'https://xxxxxxxx.supabase.co'
      anonKey: '',  // Supabase 프로젝트의 anon public key
      table: 'scores'
    }
  }
};
