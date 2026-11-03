# 팩트체크: 계류·접안시설 (q-mooring.js)
- 검증일: 2026-11-03 · 방법: 외부 출처 대조 (WebSearch/WebFetch)
- 결과 요약: ✅ 확인 37 · ✏️ 수정 8 · 🔁 교체 3

| id | 판정 | 근거 출처 | 메모 |
|---|---|---|---|
| moor-ox-01 | ✅ | [코토뱅크 岸壁(마이페디아·세계대백과)](https://kotobank.jp/word/岸壁) · [항만법 제2조 제5호(법령 원문 사본)](https://casenote.kr/법령/항만법/제2조) | "연직 벽으로 육지 토압을 지지하는 계류 구조물", 항만법상 계류시설 |
| moor-ox-02 | ✅ | [코토뱅크 桟橋(일본대백과·브리태니커)](https://kotobank.jp/word/桟橋) | 아래로 해수 자유 출입·반사파 억제·배후 토압 받지 않음 |
| moor-ox-03 | ✅ | [표준국어대사전 '물양장'](https://stdict.korean.go.kr/search/searchResult.do?pageSize=10&searchKeyword=물양장) · [코토뱅크 岸壁](https://kotobank.jp/word/岸壁) | 어선·부선 등 소형선 부두, 수심 4.5m 이하 소규모 시설 |
| moor-ox-04 | ✅ | [항만부잔교시설 관리규정(해양수산부 훈령)](https://www.law.go.kr/LSW/flDownload.do?flSeq=170580373) | 조위 변동과 관계없이 계류, 체인·지주식 고정, 도교로 육상 연결 |
| moor-ox-05 | ✅ | [UFC 4-152-01 Piers and Wharves](https://buildingcriteria2.tpub.com/ufc_4_152_01/ufc_4_152_010016.htm) · [Pile Buck – Pier & Wharf 계획](https://pilebuck.com/pier-wharf-construction-part-facility-planning/) | Pier는 해안에 수직·경사 돌출, Wharf는 해안과 거의 평행 |
| moor-ox-06 | 🔁 | [항만법 제2조 제5호 가목(법령 원문 사본)](https://casenote.kr/법령/항만법/제2조) | "정박지는 계류시설" 문항이 q-infra infra-mc-01(수역시설=정박지)과 같은 지식이라 "돌핀은 외곽시설"(X)로 교체 — 항만법상 돌핀(계선말뚝)은 계류시설 |
| moor-ox-07 | ✅ | [Wikipedia – Fender (boating)](https://en.wikipedia.org/wiki/Fender_%28boating%29) · [TU Delft – PIANC WG211 논문](https://repository.tudelft.nl/file/File_d6a376df-0e88-4f94-ab06-e08261e69851?preview=1) | E = ½·M·VB²·Cm·Ce·Cs·Cc, 접안 속도의 제곱에 비례 |
| moor-ox-08 | ✏️ | [TU Delft – PIANC WG211 논문](https://repository.tudelft.nl/file/File_d6a376df-0e88-4f94-ab06-e08261e69851?preview=1) · [ASCE – PIANC WG211 접안 속도 권고](https://ascelibrary.com/doi/10.1061/9780784484395.054) | 해설의 "대형선일수록 속도를 매우 낮게 관리"는 일반화하기 어려움(Brolsma 곡선은 약 5만 DWT 이상에서 크기와 무관하다고 가정했고, PIANC WG145·211 후속 연구는 크기 의존 가정 자체에 의문을 제기. 검색 요약 기준) → 삭제하고 PIANC의 VB(접안선에 직각인 속도 성분) 정의로 대체 |
| moor-ox-09 | ✅ | [Wikipedia – Fender (boating)](https://en.wikipedia.org/wiki/Fender_%28boating%29) | 좋은 방충재 = 높은 에너지 흡수·낮은 반력 |
| moor-ox-10 | ✅ | [Wikipedia – Fender (boating)](https://en.wikipedia.org/wiki/Fender_%28boating%29) | 공기식(요코하마형) 부유 방충재, 해상 STS에 널리 사용 |
| moor-ox-11 | ✅ | [Wärtsilä Encyclopedia – Mooring lines](https://wartsila.com/encyclopedia/term/mooring-lines) | 브레스트 라인은 선체에 거의 직각, 선박이 안벽에서 떨어지는 것을 억제 |
| moor-ox-12 | ✅ | [Milford Haven Port Authority – Mixed Moorings 공지](https://www.mhpa.co.uk/notice-to-mariners/annual-standing-notice-no-05-mixed-moorings/) | 같은 역할에 와이어·합성섬유를 섞으면 와이어가 하중을 거의 모두 받음 |
| moor-ox-13 | ✅ | [Nautical Institute MARS 200651](https://nautinst.org/resources-page/200651-gas-tanker-off-berth.html) · [American Club – Mooring Line Slack](https://www.american-club.com/files/files/API_Good_Catch_Mooring_Line_Slack.pdf) | 조석·흘수 변화에 따라 계류삭을 계속 조정해야 함 |
| moor-ox-14 | ✏️ | [Wikipedia – Cleat (nautical)](https://en.wikipedia.org/wiki/Cleat_%28nautical%29) | "주로 소형선이나 요트의 줄" 한정은 부두용 클리트도 흔해 O/X가 갈릴 수 있음 → "갑판이나 부두에 설치해 줄을 감아 고정"으로 다듬음 |
| moor-ox-15 | ✅ | [표준국어대사전 '접안'](https://stdict.korean.go.kr/search/searchResult.do?pageSize=10&searchKeyword=접안) · [항만운송사업법 시행령 제2조(사본)](https://www.nepla.ai/law/항만운송사업법시행령) | 접안 = 배를 안벽에 댐, 이안은 반대 개념(법령에 '이안·접안' 함께 씀) |
| moor-ox-16 | 🔁 | [Steamship Mutual RA50 – 윈치 브레이크 용량](https://www.steamshipmutual.com/mooring-winch-brake-holding-capacity-risk-alert-50) · [Wärtsilä – 윈치 브레이크 설계 용량](https://wartsila.com/encyclopedia/term/mooring-winch-brake-design-capacity-brake-holding-capacity) | "좌현 = 선수 볼 때 왼쪽" 문항이 q-vessel ship-ox-09(좌·우현)와 같은 지식이라 윈치 브레이크 렌더링(O)으로 교체 — 설계는 MBL 80%, 실제 설정은 60% |
| moor-ox-17 | ✅ | [Marine Insight – Mediterranean mooring](https://www.marineinsight.com/marine-navigation/mediterranean-mooring-ships/) · [ASA – Mediterranean Mooring](https://americansailing.com/articles/mediterranean-mooring-what-is-it-and-why/) | 닻 + 선미(선수) 대기, 안벽 공간 절약 |
| moor-ox-18 | ✅ | [Wikipedia – Single buoy mooring](https://en.wikipedia.org/wiki/Single_buoy_mooring) · [Wärtsilä – Mooring(SPM 정의)](https://www.wartsila.com/encyclopedia/term/mooring) | 계류한 유조선이 부이 주위로 자유롭게 회전(weathervane) |
| moor-ox-19 | ✅ | [UK P&I – Snap-back zones](https://www.ukpandi.com/news-and-resources/articles/2016/best-practice-mooring-snap-back-zones) · [Gard – Are you snap-safe?](https://gard.no/articles/are-you-snap-safe) · [TSB Canada 안전권고 03/22](https://bst-tsb.gc.ca/eng/securite-safety/marine/2022/m22c0005/m22c0005-03-22.html) | 영국 MCA COSWP: 페인트 표시는 잘못된 안도감을 줌, 계류 갑판 전체를 위험 구역으로 봄 |
| moor-ox-20 | ✅ | [Dublin Port – Berth Depths 공지](https://www.dublinport.ie/wp-content/uploads/2025/12/12-2026-Berth-Depths.pdf) | 선석별 수심을 관리하고 접안 중에도 선저 여유(0.5m)를 요구 |
| moor-mc-01 | ✅ | [Shetland Islands Council – Sullom Voe Mooring](https://www.shetland.gov.uk/sullom-voe/mooring) | 접안돌핀에 방충재를 달고, 계류돌핀은 계류삭을 받도록 배치 |
| moor-mc-02 | ✅ | [UK VOA Rating Manual – Jetties](https://gov.uk/guidance/rating-manual-section-6-part-3-valuation-of-all-property-classes/jetties-maritime-and-inland-waterway-structures) · [탱커부두 돌핀 배치 연구(koreascience)](https://www.koreascience.or.kr/article/JAKO201302757908484.pdf) | 해안에서 돌출한 구조물, 접속교·하역 플랫폼·돌핀으로 구성 |
| moor-mc-03 | ✅ | [VIMAWA 기준 초안 – Caisson-type Gravity Quaywall](https://vimawa.gov.vn/f/D04_Part%204_Caisson-type%20Gravity%20Quaywall_DRAFT%20FINAL%20%28EN%29_10%20March%202026.pdf) · [VIMAWA – Sheet Pile Quaywall](https://vimawa.gov.vn/f/D03_Part%203_Sheet%20Pile%20Quaywall_DRAFT%20FINAL%20%28EN%29_10%20March%202026.pdf) | 중력식은 벽체 자중으로, 널말뚝식은 근입부·타이로드 지지로 토압에 저항 |
| moor-mc-04 | ✅ | [Dublin Port – Berth Depths](https://www.dublinport.ie/wp-content/uploads/2025/12/12-2026-Berth-Depths.pdf) · [Forth Ports – Ruling Depths and UKC](https://www.forthports.co.uk/wp-content/uploads/2025/07/FPS-PMSC-OP-31_18-Ruling-Depths-and-Underkeel-Clearances-Tay.pdf) | 수심 = 흘수 + 선저 여유(UKC) |
| moor-mc-05 | ✅ | [Marine Insight – Fixed Berthing Window](https://www.marineinsight.com/marine-navigation/fixed-berthing-window-concept/) · [Port of Tauranga – Berthing Policy](https://www.port-tauranga.co.nz/wp-content/uploads/Berthing-and-Craneage-Policy-ID-28363.pdf) | 정기선 서비스에 미리 합의된 요일·시간 슬롯, 윈도우 안에 도착하면 우선 |
| moor-mc-06 | ✅ | [Bierwirth & Meisel (2010), EJOR 202(3)](https://econpapers.repec.org/RePEc:eee:ejores:v:202:y:2010:i:3:p:615-627) | 선석 배정 문제를 이산형·연속형·혼합형 안벽으로 분류 |
| moor-mc-07 | ✅ | [SAP Glossary – All fast](https://help.sap.com/doc/saphelp_glossary/latest/en-US/23/4560afd0c49340803e56cbd3c964d2/content.htm) · [Wikipedia – Glossary of nautical terms (M–Z)](https://en.wikipedia.org/wiki/Glossary_of_nautical_terms_%28M%E2%80%93Z%29) | All fast = 계류 완료, Single up = 출항 직전 계류삭 최소화 |
| moor-mc-08 | ✅ | [Wikipedia – Fender (boating)](https://en.wikipedia.org/wiki/Fender_%28boating%29) · [방충재 제조사 기술자료(Deers)](https://www.chinarubberfender.com/?p=2128) | 큰 전면판으로 반력을 분산해 선체 면압을 낮춤(면압 = ΣR ÷ 판 면적) |
| moor-mc-09 | ✅ | [Knowledge of Sea – Mooring a Ship](https://knowledgeofsea.com/?p=1975) · [Wärtsilä – Mooring lines](https://wartsila.com/encyclopedia/term/mooring-lines) | 헤드 라인은 선수에서 앞쪽으로 내며 선박의 뒤쪽 이동을 막음 |
| moor-mc-10 | ✅ | [Wikipedia – Bitts](https://en.wikipedia.org/wiki/Bitts) · [Wärtsilä – Fairlead](https://www.wartsila.com/encyclopedia/term/fairlead) · [Wärtsilä – Windlass](https://www.wartsila.com/encyclopedia/term/windlass) | 쌍기둥에 8자로 감음 / 페어리드 = 계류삭 안내구 / 양묘기 = 닻 감아올림 |
| moor-mc-11 | ✅ | [Trelleborg – Quick Release Mooring Hooks](https://www.trelleborg.com/en/marine-and-infrastructure/products-solutions-and-services/marine/docking-and-mooring/mampaey-by-trelleborg/mooring-and-berthing) · [Sullom Voe – 모든 돌핀에 QRH](https://www.shetland.gov.uk/sullom-voe/mooring) | 하중이 걸린 상태에서 원격으로 이탈, 하중 원격 감시 |
| moor-mc-12 | ✏️ | [Wärtsilä – Mooring(MBM/CBM·SPM 정의)](https://www.wartsila.com/encyclopedia/term/mooring) · [TransNav 2019 – CBM/SPM 비교](https://www.transnav.eu/html,889.html) | MBM은 보통 선수=선박 닻·선미=부이 조합이라 "선수와 선미를 여러 부이에" 묘사를 "여러 계류 부이와 선박 자체의 닻 등"으로 정정, 해설의 미확인 주장(선회 수역·적합 해역) 교체 |
| moor-mc-13 | ✏️ | [Wikipedia – Single buoy mooring](https://en.wikipedia.org/wiki/Single_buoy_mooring) | 출처는 "commonly used"라서 "가장 널리 쓰이는"을 "대표적인"으로 바꿈, 해설을 6~8가닥 방사형 체인·호서·부유 호스 구성으로 정정 |
| moor-mc-14 | ✅ | [Port Economics, Management & Policy – STS cranes](https://porteconomicsmanagement.org/portainers-ship-to-shore-container-cranes/) · [OCIMF – Ship to Ship Transfer Guide](https://www.ocimf.org/publications/books/ship-to-ship-transfer-guide-for-petroleum-chemicals-and-liquefied-gases) | STS = Ship-to-Shore 크레인 / Ship-to-Ship 환적 |
| moor-mc-15 | ✅ | [Trelleborg – SmartDock Laser](https://www.trelleborg.com/en/marine-and-infrastructure/products-solutions-and-services/marine/docking-and-mooring/docking-aid-system/smart-dock-laser) | 레이저 2기로 속도·거리·각도 측정, 부두 대형 표시판·휴대 단말 |
| moor-mc-16 | ✅ | [UNCTAD 2012 발표(Soberón)](https://unctad.org/meetings/en/Presentation/dtl_ttl_2012d10_Soberon.pdf) · [CyberLogitec – 선석점유율 인사이트](https://cyberlogitec.com/en/sub/insight/article_view.php?idx=328) | 점유율이 높을수록 체선·대기 시간 증가 |
| moor-sa-01 | ✅ | [우리말샘 '선석'](https://opendict.korean.go.kr/search/searchResult?focus_name_top=query&query=선석) | "항만에서 배를 매어 두는 위치" |
| moor-sa-02 | ✅ | [표준국어대사전 '방현재'](https://stdict.korean.go.kr/search/searchResult.do?pageSize=10&searchKeyword=방현재) · [Wikipedia – Fender (boating)](https://en.wikipedia.org/wiki/Fender_%28boating%29) | 방현재 = 방충재 동의어로 accept 적정 |
| moor-sa-03 | ✅ | [표준국어대사전 '계선주'](https://stdict.korean.go.kr/search/searchResult.do?pageSize=10&searchKeyword=계선주) | "배를 매어 두기 위하여 부두·잔교 따위에 세워 놓은 기둥" |
| moor-sa-04 | ✏️ | [Knowledge of Sea – Mooring a Ship](https://knowledgeofsea.com/?p=1975) · [Wärtsilä – Mooring lines](https://wartsila.com/encyclopedia/term/mooring-lines) | accept에 복수형 "spring lines" 추가(선수 스프링은 뒤로, 선미 스프링은 앞으로 뻗음 확인. '선수뒷줄·선미앞줄'은 출처를 못 찾았으나 방향 설명과 맞아 유지) |
| moor-sa-05 | ✏️ | [Wikipedia – Monkey's fist(MCA COSWP 인용)](https://en.wikipedia.org/wiki/Monkey%27s_fist) · [West of England P&I – 히빙 라인 추 사용](https://www.westpandi.com/news-and-resources/loss-prevention-bulletins/monkey-s-fists-on-heaving-lines-use-of-inappropria) · [Peel Ports – 추 단 히빙 라인 금지](https://www.peelports.com/media/thvdsl0m/standing-nasbo-no-9-use-of-inappropriate-or-weighted-heaving-lines.pdf) | 문제의 "끝에 작은 추"는 안전규범상 금지 관행이라 삭제, 해설에 "로프로만 만들고 추 금지" 추가, accept에 "heaving lines" 추가 |
| moor-sa-06 | ✅ | [UK P&I – Snap-back zones](https://www.ukpandi.com/news-and-resources/articles/2016/best-practice-mooring-snap-back-zones) | 합성섬유는 더 많이 늘어나 에너지를 저장, 끊어지면 순간적으로 튕겨 나감 |
| moor-sa-07 | ✅ | [김은수·김근섭(2016), 한국항해항만학회지](https://koreascience.kr/article/JAKO201609562999738.page?lang=ko) · [경북매일 – 체선 개념](https://kbmaeil.com/article/202203150330080) | 수용능력을 넘어 입항한 선박이 하역 순서를 기다리는 상태 |
| moor-sa-08 | 🔁 | [김은수·김근섭(2016), 한국항해항만학회지](https://koreascience.kr/article/JAKO201609562999738.page?lang=ko) · [Bentham – Smart Port Management and Strategy](https://benthamscience.com/public/chapter/16918) | ETB 문항이 검증 시점의 q-vessel ship-mc-12(접안 예정 시각 약어 = ETB)와 같은 문제라 선석 운영 지표 '대기율'(묘박지 대기시간 ÷ 접안시간)로 교체 |
| moor-sa-09 | ✏️ | [Wikipedia – Lightering](https://en.wikipedia.org/wiki/Lightering) | "소형 선박"을 정의(크기가 다른 선박 간, 더 작은 선박으로)에 맞춰 "더 작은 선박"으로 바꾸고, accept에 표기 변형 "lightening" 추가 |
| moor-sa-10 | ✅ | [한라 – 부산항 신항 서컨테이너터미널(2-6단계) 설계사례](https://koreascience.kr/article/CFKO201922850135779.pdf) | 정의를 적은 공식 출처는 못 찾음. 용례("안벽 전면…법선을 따라")만 확인해 유지 |
| moor-sa-11 | ✅ | [항만운송사업법 시행령 제2조(사본)](https://www.nepla.ai/law/항만운송사업법시행령) | 본선 이안·접안 보조 "줄잡이 역무" = 항만용역업 |
| moor-sa-12 | ✏️ | [표준국어대사전 '계선부표'](https://stdict.korean.go.kr/search/searchResult.do?pageSize=10&searchKeyword=계선부표) | 정의 확인. accept에 복수형 "mooring buoys" 추가 |

## 비고
- 위키백과는 보조 근거로만 썼다. 방충재(ox-07·09·10, mc-08)는 위키백과와 제조사 자료, 계류 장비 용어는 Wärtsilä 해사 백과를 함께 봤다.
- 국가법령정보센터(law.go.kr) 본문은 스크립트 렌더링 때문에 직접 읽지 못해, 항만법·항만운송사업법 시행령은 법령 원문 사본(casenote, nepla)으로 조문을 확인했다. 항만부잔교시설 관리규정은 law.go.kr 첨부 파일 원문을 읽었다.
- 검증 중 q-vessel.js가 동시에 수정되어 ship-mc-12가 RTA 문항으로 바뀌었다(ETB는 오답 보기·해설에만 남음). moor-sa-08 교체는 검증 시점 기준이며, 확인된 '대기율' 문항을 그대로 유지했다.

## 추가 문항 (오케스트레이터, 2026-11-03)
| id | 판정 | 근거 출처 | 메모 |
|---|---|---|---|
| moor-sa-13 | ➕ 추가 | [IQAX — What do ETD/ETA/ATD mean](https://www.iqax.com/en/blog/what-do-etdetaatd-mean-en/), [SK SEAGATE 사이트맵 — Ship Berthing › ETB Change Log](https://skseagate.skinnovation.com/view/seagate/sys/sitemap/sitemap01) | 병렬 검증 중 moor-sa-08·ship-mc-12의 ETB 문항이 모두 교체되어 은행에서 ETB가 사라짐 → 프로젝트(SK 울산 선석 운영) 핵심 용어라 1문항 복원 |
