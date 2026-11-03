window.QUESTION_BANK = window.QUESTION_BANK || [];
window.QUESTION_BANK.push(
  // ===== OX (10) =====
  {
    id: "dem-ox-01", type: "ox", category: "체선료·용선계약",
    question: "ASBATANKVOY에서는 선박이 관습적 묘박지(Customary anchorage)에 도착하면 선석 유무와 관계없이(Berth or no berth) NOR을 제출할 수 있고, 레이타임은 NOR 수령 후 6시간이 지난 때와 선박이 선석에 도착한 때 중 먼저 오는 시점에 개시된다.",
    answer: true,
    explanation: "ASBATANKVOY Part II 6조의 내용이다. 같은 조항은 NOR 제출 후 용선자가 통제할 수 없는 사유로 접안이 늦어진 시간은 사용 레이타임(Used laytime)으로 계산하지 않는다고 덧붙인다."
  },
  {
    id: "dem-ox-02", type: "ox", category: "체선료·용선계약",
    question: "ASBATANKVOY 인쇄 서식에서는 선박이 묘박지에서 하역 선석까지 이동(Shifting)하는 데 걸린 시간도 사용 레이타임(Used laytime)으로 계산한다.",
    answer: false,
    explanation: "7조는 묘박지에서 선적·양하 선석까지 이동하는 시간과 밸러스트수·슬롭(Slops) 배출 시간을 사용 레이타임으로 계산하지 않는다고 정한다. SOF로 레이타임을 재구성할 때 이 시간을 따로 빼야 한다."
  },
  {
    id: "dem-ox-03", type: "ox", category: "체선료·용선계약",
    question: "레이타임 조건에서 일요일·공휴일을 제외(Excepted)한다고 정해 두었더라도, 그날 실제로 하역을 하면 그 시간은 자동으로 레이타임에 포함된다.",
    answer: false,
    explanation: "BIMCO Laytime Definitions 2013 정의 19에 따르면 제외(Excepted)로 정한 날은 하역을 하더라도 레이타임으로 계산하지 않는다. 실제 작업 시간을 넣으려면 'Unless used'(정의 22) 같은 문구를 따로 두어야 한다."
  },
  {
    id: "dem-ox-04", type: "ox", category: "체선료·용선계약",
    question: "ASBATANKVOY에서는 화재·폭발·폭풍이나 파업, 또는 용선자·공급자·송하인·수하인 측 설비(Plant)의 기계·장비 고장 때문에 발생한 체선에 대해 체선료율이 절반으로 줄어든다.",
    answer: true,
    explanation: "8조 단서 조항으로, 이런 사유로 발생한 체선 시간에는 Part I에 적은 체선료율의 절반만 적용된다. 그래서 체선 사유를 어떻게 분류하느냐가 체선료 금액에 직접 영향을 준다."
  },
  {
    id: "dem-ox-05", type: "ox", category: "체선료·용선계약",
    question: "BIMCO Laytime Definitions 2013에 따르면, 레이타임 계산에서 빼 주는 예외 사유는 계약에 따로 정하지 않아도 체선 기간(Time on demurrage)에 똑같이 적용된다.",
    answer: false,
    explanation: "정의 30은 계약에 특별히 명시하지 않는 한 체선료(Demurrage)에는 레이타임 예외가 적용되지 않는다고 정한다. 그래서 예외를 체선 기간까지 넓히려면 'or time on demurrage' 같은 문구를 계약에 넣는다."
  },
  {
    id: "dem-ox-06", type: "ox", category: "체선료·용선계약",
    question: "선박이 아직 하역 준비를 마치지 못한 상태에서 낸 무효 NOR은, 나중에 준비가 끝나면 그 시점부터 자동으로 효력이 생겨 레이타임이 개시된다.",
    answer: false,
    explanation: "영국 항소법원 The Mexico I 판례는 무효 NOR에 이런 '지연 발효(Delayed action)' 효과가 없다고 보았다. 그래서 실무에서는 준비를 마친 뒤 새 NOR을 다시 제출해 둔다."
  },
  {
    id: "dem-ox-07", type: "ox", category: "체선료·용선계약",
    question: "용선자가 무효 NOR을 거절하지 않고 하역을 시작했다면, 그 하역 개시가 NOR 무효에 대한 권리 포기(Waiver)로 인정되어 레이타임이 진행될 수 있다.",
    answer: true,
    explanation: "영국 항소법원 The Happy Day(2002) 판례는 용선자의 하역 개시를 그 시점부터 NOR 무효에 대한 권리 포기로 보았다. 다만 권리 포기나 금반언(Estoppel)이 인정되려면 말이나 행동에 의한 명백한(Unequivocal) 표시가 있어야 한다."
  },
  {
    id: "dem-ox-08", type: "ox", category: "체선료·용선계약",
    question: "영국 귀족원 The Johanna Oldendorff 판례에 따르면, 항구용선(Port charter)에서 선석으로 바로 갈 수 없는 선박은 항구 안에서 용선자의 즉각적·실효적 처분(Immediate and effective disposition) 아래 있는 위치에 도달하면 도착선(Arrived ship)이 된다.",
    answer: true,
    explanation: "Lord Reid가 제시한 기준으로, 항구 안의 통상 대기 장소에 있으면 특별한 사정이 없는 한 이 요건을 갖춘 것으로 본다. 도착선이 되어야 유효한 NOR을 내고 레이타임을 시작할 수 있다."
  },
  {
    id: "dem-ox-09", type: "ox", category: "체선료·용선계약",
    question: "원유선이 묘박지에서 선석을 기다리는 '체선' 현상이 생기면, 허용 레이타임이 남아 있더라도 그 대기 시간에는 곧바로 체선료(Demurrage)가 붙는다.",
    answer: false,
    explanation: "BIMCO 정의 30에서 체선료는 레이타임이 끝난 뒤의 지연에 대해 지급하는 약정금이다. 묘박지 대기 시간은 NOR·계약 조건에 따라 레이타임에 산입될 뿐이고, 레이타임을 다 쓴 뒤의 시간부터 체선료가 발생한다."
  },
  {
    id: "dem-ox-10", type: "ox", category: "체선료·용선계약",
    question: "The Eagle Valencia(2010, 영국 항소법원) 사건의 Shellvoy 5 용선계약에는 NOR 제출 후 6시간 안에 검역허가(Free pratique)나 세관 통관을 받지 못하면 처음 낸 NOR이 무효가 된다는 추가조항이 있었고, 법원은 이 조항에 따라 NOR을 무효로 보았다.",
    answer: true,
    explanation: "검역허가가 NOR 제출 6시간이 지난 뒤에 나와 원래 NOR이 무효가 되었고, 다른 근거로 한 대체 청구도 90일 안에 제대로 증빙되지 않아 Time bar로 소멸했다. 법원은 선주가 새 NOR을 추가로 내 두면 이런 위험을 피할 수 있다고 지적했다."
  },

  // ===== 객관식 (8) =====
  {
    id: "dem-mc-01", type: "mc", category: "체선료·용선계약",
    question: "ASBATANKVOY 조건에서 Part I의 체선료가 일당 USD 24,000이고, 사용 시간이 허용 레이타임을 30시간 초과했다. 반액 사유가 없을 때 체선료는?",
    choices: ["USD 24,000", "USD 48,000", "USD 30,000", "USD 720,000"],
    answer: 2,
    explanation: "8조는 체선료를 운항 시간(Running hour) 단위로, 1시간 미만도 비례(Pro rata)로 계산하므로 24,000 ÷ 24 × 30 = USD 30,000이다."
  },
  {
    id: "dem-mc-02", type: "mc", category: "체선료·용선계약",
    question: "영국 항소법원 The Eternal Bliss(2021) 판결이 인용한 정의에 따를 때, 체선료(Demurrage)의 법적 성격으로 옳은 것은?",
    choices: [
      "약정된 정박기간을 넘긴 지연에 대해 용선자가 지급하기로 미리 정한 손해배상액(Liquidated damages)",
      "선주가 화물 운송의 대가로 받는 운임(Freight)의 일부",
      "항만당국이 선박의 정박에 대해 부과하는 공과금",
      "하역을 일찍 끝낸 용선자에게 선주가 지급하는 금액"
    ],
    answer: 0,
    explanation: "Scrutton의 정의대로 체선료는 레이타임을 넘긴 지연에 대한 약정 손해배상액이고, 이 판결은 계약에 다른 정함이 없으면 체선료가 레이타임 내 하역 불이행으로 생긴 손해 전체를 정액화한다고 보았다. 하역을 일찍 끝냈을 때 선주가 주는 돈은 조출료(Despatch)다."
  },
  {
    id: "dem-mc-03", type: "mc", category: "체선료·용선계약",
    question: "ASBATANKVOY 5조(Laydays)에 따르면, 선박이 Part I에 정한 Laydays 개시일보다 일찍 도착해 NOR을 제출했을 때 레이타임은 어떻게 되는가?",
    choices: [
      "NOR을 제출한 순간 바로 개시된다",
      "용선자의 승인(Sanction)이 없으면 Part I에 정한 날짜 전에는 개시되지 않는다",
      "NOR 수령 후 6시간이 지나면 Laydays와 관계없이 개시된다",
      "선박이 도착한 시점부터 곧바로 체선료가 발생한다"
    ],
    answer: 1,
    explanation: "5조는 용선자의 승인 없이는 Part I에 정한 날짜 전에 레이타임이 개시되지 않는다고 정한다. 조기 NOR·조기 접안을 허용할 때의 시간 처리는 라이더(Rider) 조항으로 따로 정하기도 한다(The Front Commander)."
  },
  {
    id: "dem-mc-04", type: "mc", category: "체선료·용선계약",
    question: "용선계약의 Laycan에서 해약일(Cancelling date)이 갖는 의미로 가장 알맞은 것은?",
    choices: [
      "체선료율이 두 배로 오르기 시작하는 날",
      "허용 레이타임이 끝나는 날",
      "선주가 운임을 청구할 수 있는 첫날",
      "선박이 그때까지 오지 못하면 용선자가 계약을 해제하고 다른 선박을 구할 수 있는 기준일"
    ],
    answer: 3,
    explanation: "The Front Commander 판결은 Laycan 기간이 용선자에게 화물 준비 시점을 알려 주고, 선박이 늦으면 용선자가 해약으로 계약에서 벗어나 대체 수단을 찾게 해 준다고 설명했다. 선박이 늦게 와도 용선자는 해약하지 않고 계약을 유지할 수 있다."
  },
  {
    id: "dem-mc-05", type: "mc", category: "체선료·용선계약",
    question: "Shellvoy 5, BPVOY 3 같은 탱커 용선계약과 ASBATANKVOY 라이더에서 볼 수 있는 체선료 Time bar 조항의 내용으로 옳은 것은?",
    choices: [
      "정해진 기간(흔한 예: 하역 완료 후 90일) 안에 증빙서류를 갖춘 서면 클레임이 용선자에게 도달하지 않으면 체선료 청구권이 소멸한다",
      "체선료 클레임은 기간 제한 없이 언제든 제기할 수 있다",
      "체선료는 선박이 항구를 떠나기 전에 구두로 청구해야만 효력이 있다",
      "증빙서류 없이 청구 금액만 통지해도 기간 안에 청구한 것으로 인정된다"
    ],
    answer: 0,
    explanation: "Shellvoy 5(15조 3항), BPVOY 3, 개정 ASBATANKVOY 라이더 모두 90일 기한과 증빙서류 요건을 둔 사례가 판례에 나온다. B/L 누락(Tricon v MTM)이나 무효 NOR만 첨부한 경우(The Eagle Valencia)에는 청구가 소멸했다."
  },
  {
    id: "dem-mc-06", type: "mc", category: "체선료·용선계약",
    question: "BIMCO Laytime Definitions 2013에서, 지정 선석과 항구 안의 통상 대기 장소를 모두 쓸 수 없을 때 항구 밖의 공인된 대기 장소에서도 NOR을 제출하고 레이타임을 개시할 수 있게 하는 문구는?",
    choices: ["WIBON(Whether In Berth Or Not)", "Unless used", "WIPON(Whether In Port Or Not)", "Reversible laytime"],
    answer: 2,
    explanation: "정의 28의 WIPON은 항구 밖 대기 장소에서의 NOR까지 허용한다. WIBON(정의 27)은 선석이 없을 때 항구 안 통상 대기 장소에서의 NOR을 허용하는 문구다."
  },
  {
    id: "dem-mc-07", type: "mc", category: "체선료·용선계약",
    question: "BIMCO Laytime Definitions 2013이 정의하는 NOR(Notice of Readiness)의 내용으로 옳은 것은?",
    choices: [
      "선박이 하역을 마치고 출항 준비가 되었다는 통지",
      "선하증권(B/L)이 발행되어 화물을 인도할 수 있다는 통지",
      "허용 레이타임이 끝나 체선이 시작되었다는 통지",
      "선박이 계약에 따라 항구 또는 선석에 도착했고 하역할 준비가 되었다는 통지"
    ],
    answer: 3,
    explanation: "정의 25에 따르면 NOR은 선박이 계약에서 정한 항구 또는 선석에 도착했고 선적·양하 준비가 되었음을 알리는 통지다. 도착과 준비라는 두 요건을 갖추지 못한 NOR은 무효가 될 수 있다."
  },
  {
    id: "dem-mc-08", type: "mc", category: "체선료·용선계약",
    question: "ASBATANKVOY Part I에서 허용 레이타임 총량(Total laytime)을 표시하는 단위는?",
    choices: ["청천작업일(Weather working days)", "연속 시간(Running hours)", "해치당 일일 하역 기준(Per hatch per day)", "작업일(Working days)"],
    answer: 1,
    explanation: "Part I에는 'Total laytime in running hours'로 적고, 7조는 그 시간을 레이타임으로 허용한다. BIMCO 정의 13에서 Running hours는 끊김 없이 바로 이어지는 시간을 뜻한다."
  },

  // ===== 주관식 (6) =====
  {
    id: "dem-sa-01", type: "short", category: "체선료·용선계약",
    question: "항구에서 일어난 사건과 그 일시를 시간순으로 기록하고 관계 당사자가 서명하는 문서로, 레이타임 계산과 체선료 클레임의 증빙자료가 되는 것은? (영문 약어 3글자)",
    answer: "SOF",
    accept: ["SOF", "Statement of Facts", "Statement of Fact", "사실기록서"],
    explanation: "SOF(Statement of Facts)는 체선료 청구 때 레이타임 계산서(Laytime calculation)·NOR 등과 함께 내는 핵심 증빙이다(Tricon v MTM). 기록이 부정확하면 클레임 자체가 다투어질 수 있다."
  },
  {
    id: "dem-sa-02", type: "short", category: "체선료·용선계약",
    question: "용선계약에서 선적 준비를 갖추어야 하는 기간의 시작일(Laydays 개시일)과 해약일(Cancelling date)을 함께 묶어 부르는 말은? (영문 6글자)",
    answer: "Laycan",
    accept: ["Laycan", "Laydays and Cancelling", "Laydays Cancelling", "레이캔"],
    explanation: "ASBATANKVOY Part I의 'Laydays: Commencing / Cancelling' 칸에 날짜를 적으며, 판례도 이 기간을 Laycan이라 부른다(The Front Commander)."
  },
  {
    id: "dem-sa-03", type: "short", category: "체선료·용선계약",
    question: "레이타임 조건에서 일요일과 공휴일도 레이타임에 포함한다는 뜻의 약어는? (영문 약어 5글자)",
    answer: "SHINC",
    accept: ["SHINC", "Sundays and Holidays Included", "Sundays Holidays Included", "일요일공휴일포함", "일요일 및 공휴일 포함"],
    explanation: "SHINC는 Sundays and Holidays Included의 약어로, 'ATDNSHINC(any time of day or night Sundays and holidays included)'처럼 쓰인다. 반대로 제외(Excepted)로 정한 날은 하역을 해도 레이타임에 넣지 않는다(BIMCO 정의 19)."
  },
  {
    id: "dem-sa-04", type: "short", category: "체선료·용선계약",
    question: "지정 선석이 비어 있지 않을 때 선박이 항구 안의 통상 대기 장소에서 NOR을 제출하고 계약에 따라 레이타임을 개시할 수 있게 하는 문구의 약어는? (영문 약어 5글자)",
    answer: "WIBON",
    accept: ["WIBON", "Whether In Berth Or Not", "Berth or no berth", "선석유무불문"],
    explanation: "BIMCO 정의 27의 WIBON(Berth or no berth와 같은 뜻)이다. 영국 귀족원 The Kyzikos 판례는 이 문구를 선석이 없는(Not available) 경우에만 적용된다고 보아, 선석은 비었지만 안개로 접근하지 못한 경우에는 적용하지 않았다."
  },
  {
    id: "dem-sa-05", type: "short", category: "체선료·용선계약",
    question: "탱커가 하역을 마친 뒤 레이타임 또는 체선 시간 계산을 멈추는 기준으로 SOF에 흔히 기록되는 사건은? (영문 2단어)",
    answer: "Hoses disconnected",
    accept: ["Hoses disconnected", "Hose disconnected", "Hoses off", "Hose off", "Disconnection of hoses", "호스 분리", "호스 분리 완료"],
    explanation: "The Sabrewing(2007) 판결은 '호스가 분리되고 시간이 멈췄다'고 적었고, Tricon v MTM에서도 양하 완료 시점이 호스 분리 시각으로 기록되었다."
  },
  {
    id: "dem-sa-06", type: "short", category: "체선료·용선계약",
    question: "용선자가 선박이 항구에 도착했을 때 지체 없이 안전하게 닿을 수 있는 이용 가능한 선석을 제공하기로 약속하는 용선계약 문구는? (영문 3단어)",
    answer: "Reachable on arrival",
    accept: ["Reachable on arrival", "Reachable on her arrival", "도착 시 접근 가능", "도착 시 도달 가능"],
    explanation: "BIMCO 정의 3의 문구다. 비슷한 Always accessible(정의 4)은 여기에 더해 하역 전·중·후 언제든 선석에서 지체 없이 안전하게 떠날 수 있도록 보장한다."
  }
);
