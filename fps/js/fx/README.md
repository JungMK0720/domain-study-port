# fx — 효과음·이펙트 (⚓ 항만 작전)

외부 사운드·이미지 파일 없이 **WebAudio 합성**과 **three.js 도형·캔버스 텍스처**로 만든다. 모든 소리와 그림은 오리지널이다.
잔혹한 표현은 쓰지 않는다. 플레이어 피격은 피 대신 갑옷 불꽃·히트마커로 표현한다.

| 파일 | 내용 |
|---|---|
| `audio.js` | `createAudio()`, `SOUND_NAMES` |
| `effects.js` | `createEffects(scene, camera, opts)` |
| `../../fx-demo.html` | 버튼 데모. `?smoke=1`을 붙이면 자가 테스트를 돌린다 |

## 연결 예시 (core·weapons)

```js
import { createAudio } from './fx/audio.js';
import { createEffects } from './fx/effects.js';

const audio = createAudio({ volume: 0.8 });
const fx = createEffects(scene, camera, { renderer });          // renderer: 파티클 크기 계산용(권장)
addEventListener('pointerdown', () => audio.unlock(), { once: true });  // 첫 입력에서 언락

// 매 프레임: 엔진이 카메라를 갱신한 "뒤", 렌더 "전"
audio.setListener(camera.position, yaw, pitch);  // 눈 위치(core의 pos는 발바닥 → y + 1.6), 라디안, 'YXZ'
fx.update(dt);
// 1인칭 총구 섬광은 weapons/viewmodel.js의 내장 섬광(opts.muzzleFlash)과 fx.muzzleFlash 중 하나만 쓴다
// (원격 플레이어의 총구 섬광은 fx.muzzleFlash).

// 사격 1발
fx.muzzleFlash(muzzlePos, dir, 'rifle');
fx.tracer(muzzlePos, hit ? hit.point : farPoint, 'rifle');
if (hit) fx.impact(hit.point, hit.normal, hit.mat);   // mat = 맵 재질 이름 또는 'player'
fx.shellEject(muzzlePos, dir, { groundY: feetY });
audio.play('rifle');                                  // 내 총소리: pos 없음 → 2D
audio.play('rifle', { pos: remoteMuzzle });           // 남의 총소리: 3D(HRTF)
```

## audio.js

`createAudio({ volume = 0.8, quality = 'high', maxVoices3d = 20, maxVoices2d = 8 })`가 돌려주는 메서드는 아래와 같다.

| 메서드 | 설명 |
|---|---|
| `unlock()` → `Promise<boolean>` | 첫 사용자 입력 핸들러 안에서 호출한다. 여기서 AudioContext를 만들고, 유휴 시간에 모든 소리를 미리 합성한다(프레임마다 변형 1개). 여러 번 불러도 안전하다 |
| `setVolume(v)` | 0~1. 리미터 뒤에 있으므로 올려도 클리핑이 나지 않는다 |
| `setListener(pos, yaw, pitch)` | `pos`는 `{x,y,z}`, `Vector3`, `[x,y,z]` 중 하나. three.js 카메라 관례(−Z가 정면)를 따른다 |
| `play(name, { pos, gain = 1, rate = 1 })` → `{ id, stop(fade) }` 또는 `null` | `pos`가 있으면 3D, 없으면 2D다. 언락 전, 알 수 없는 이름, 들리지 않는 거리, 우선순위에 밀린 경우에는 `null`을 돌려준다 |
| `stopAll(fade)` · `setQuality('low'\|'high')` · `getStats()` · `dispose()` | low는 equalpower 패닝, 3D 보이스 12개, 잔향 절반이다 |

### 소리 목록

| name | 성격 | 우선순위 | 3D 기준거리/최대 |
|---|---|---|---|
| `rifle` | 짧은 크랙과 저음 펀치, 짧은 꼬리 | 6 | 8 m / 260 m |
| `sniper` | 날카로운 크랙, 묵직한 붐, 긴 메아리(지연 탭 5개) | 7 | 10 m / 420 m |
| `pistol` | 가볍고 스냅 있는 발사음 | 6 | 6 m / 190 m |
| `knife_slash` / `knife_hit` | 공기 가르는 휙(대역 스윕) / 둔탁한 타격음 | 5 | 2.5~3 m / 30~40 m |
| `grenade_pin` / `grenade_bounce` | 금속 핀 링 / 금속 굴러가는 소리 | 5 | 2~3 m / 25~55 m |
| `explosion` | 저음 붐, 파편 후드득, 잔향 | 8 | 12 m / 420 m |
| `reload_mag_out` / `reload_mag_in` / `bolt` / `dry_fire` / `switch` | 기계음 | 4 | 1.5~2 m / 15~25 m |
| `footstep_concrete` / `footstep_steel` | 사각거리는 발소리 / 강판 갑판의 쿵 | 3 | 2~2.5 m / 32~45 m |
| `hit_marker` / `headshot` / `kill` | 피드백 (항상 2D) | 8 / 9 / 9 | — |
| `round_start` | 선박 기적(낮은 혼, 맥놀이) | 10 | — |
| `round_win` / `round_lose` / `low_hp_heartbeat` | 상승 아르페지오 / 하강 모티프 / 심장 박동 1회 | 10 / 10 / 7 | — |

- `low_hp_heartbeat`는 한 번만 뛴다. 체력이 낮을 때 호출하는 쪽이 0.9초쯤마다 다시 재생한다. 발소리 간격과 재질 선택도 호출하는 쪽이 정한다.
- 같은 소리는 변형 2~4개 중 무작위로 고르고, 재생 속도에 ±2~8% 지터를 준다. 연사해도 기계적으로 들리지 않게 하기 위해서다.

### 오디오 그래프와 정책

```
[보이스: Gain → LowPass → Panner(HRTF, inverse 거리 감쇠)] ─┬→ mix → Compressor → makeup → Limiter(-3 dB) → SoftClip(<0.99) → Volume → out
                                                         └→ send → Convolver(합성 항만 잔향 IR) → mix
```

- **보이스 풀**: 3D 20개와 2D 8개의 노드 체인(Gain·Filter·Panner·Send)을 처음에 만들어 재사용한다. 합성한 AudioBuffer는 캐시한다. `AudioBufferSourceNode`는 스펙상 일회용이라 매번 새로 만든다(가벼운 객체다).
- **상한과 우선순위**: 소리마다 동시 재생 상한(`max`)을 둔다. 넘치면 같은 소리 중 가장 오래된 것을 교체한다. 풀이 차면 `우선순위 − 거리/40` 점수가 가장 낮은 보이스를 10 ms 페이드로 빼앗는다. 새 소리의 점수가 더 낮으면 재생하지 않는다.
- **거리**: PannerNode inverse 모델로 감쇠한다. 총성과 폭발은 거리가 24 m 늘 때마다 차단 주파수를 절반으로 낮춰 먹먹하게 한다(최저 500 Hz). 잔향 비율은 멀수록 커진다.

## effects.js

`createEffects(scene, camera, { renderer, applyShake = true })`

| 메서드 | 설명 |
|---|---|
| `muzzleFlash(pos, dir, kind)` | 십자 화염 꽃잎, 코어 스프라이트, 옅은 연기, 짧은 라이트. `kind`는 `'rifle'`, `'sniper'`(머즐 브레이크 측면 화염), `'pistol'`이다. `'nor'`, `'sof'` 같은 무기 이름 일부도 인식한다 |
| `tracer(from, to, kind)` | 빛줄기가 날아간다(소총 480 m/s, 저격 900 m/s, 권총 360 m/s). 저격은 옅은 공기 궤적이 0.45초 남는다 |
| `impact(point, normal, mat)` | 재질별 이펙트(아래 표). 물을 뺀 재질에는 탄흔을 남긴다(링 버퍼) |
| `explosion(pos, { radius = 6 })` | 섬광 스프라이트, 화염, 연기, 지면 먼지, 불씨 줄기, 충격파 링, 포인트 라이트 0.4초, 카메라 흔들림(거리 비례) |
| `shellEject(pos, dir, { groundY })` | 탄피가 오른쪽으로 튀어 바닥에서 튕긴다. `groundY`를 주지 않으면 `pos.y − 1.45`를 쓴다 |
| `update(dt)` | 매 프레임 호출한다(dt는 0.1초로 제한) |
| `clear(keepDecals)` | 라운드를 리셋할 때 진행 중인 이펙트를 즉시 끈다 |
| `setQuality('low'\|'high')` · `setReducedMotion(true\|false\|null)` | `null`이면 OS 설정을 따른다 |
| `addShake(0..1)` · `getShake()` · `setApplyShake(bool)` | 흔들림 제어(아래 참고) |
| `getStats()` · `dispose()` | 통계 조회 / 씬에서 제거하고 지오메트리·머티리얼·텍스처를 모두 해제 |

| `mat` | 이펙트 |
|---|---|
| `steel` `rust` `deck` `tank` `pipe` `container_red` `yellow` `white` | 불꽃 줄기, 섬광 점, 옅은 연기, 어두운 탄흔 |
| `concrete` `asphalt` `grass` `wood` (모르는 재질은 concrete로 처리) | 재질 색 먼지, 파편 조각, 탄흔 |
| `water` | 물방울, 물안개, 물결 링 |
| `glass` | 반짝임, 유리 조각 |
| `player` | 흰빛 퍼프와 짧은 불꽃(피 없음), 탄흔 없음 |

### 성능 (풀 상한)

| 항목 | high | low |
|---|---|---|
| 포인트 파티클(연기류·가산류 각각) | 1600 | 500 |
| 불꽃 줄기(LineSegments) | 320 | 96 |
| 탄흔(InstancedMesh, 링 버퍼) | 96 | 32 |
| 탄피(InstancedMesh) | 24 | 8 |
| 총구 섬광 · 예광탄 · 링 · 폭발 섬광 | 8 · 28 · 8 · 3 | 같음 |
| 포인트 라이트 | 2 (low는 총구 라이트 없음) | 2 |

- 파티클은 packed typed array에 담고 swap-remove로 지운다. 활성 개수만큼만 GPU에 올린다(`addUpdateRange`). 파티클 시스템 하나가 draw call 1개다. 상한에 닿으면 새 파티클은 생략하고 `getStats().dropped`에 센다.
- 그림자를 쓰지 않는다. 라이트 2개는 항상 씬에 두고 세기만 0으로 내린다. 라이트 개수가 바뀌면 셰이더를 재컴파일하기 때문이다. 폭발 라이트(우선순위 2)는 총구 라이트(1)에 빼앗기지 않는다.
- 생성 이후 프레임마다 할당이 없다. 임시 벡터와 프리셋을 재사용한다.

### 흔들림과 감소된 동작

- `prefers-reduced-motion: reduce`이면 섬광 불투명도를 0.4배로, 라이트 세기를 0.4배로 줄이고 총구 라이트는 끈다. 폭발 섬광 크기는 0.7배, 흔들림은 0.2배다. OS 설정 변경을 실시간으로 반영한다.
- 기본값(`applyShake: true`)에서는 `update()`가 `camera.rotation`에 작은 오프셋을 더한다. 다음 프레임에는 엔진이 덮어쓰지 않은 축만 그 오프셋을 되돌리므로 조준이 누적해서 틀어지지 않는다. 엔진이 회전을 직접 합성하고 싶으면 `setApplyShake(false)`로 끄고 `getShake()`가 돌려주는 `{pitch, yaw, roll}`을 더하면 된다.

## 검증

- `node --check fps/js/fx/audio.js`와 `node --check fps/js/fx/effects.js`가 통과한다.
- `fx-demo.html?smoke=1`은 헤드리스 Chrome에서 25개 항목을 검사하고 모두 통과한다.
  - 이펙트: 3회 스폰한 뒤 활성 이펙트가 0으로 돌아오는지(과부하 포함), GPU 리소스가 늘지 않는지, 씬 자식 수가 유지되는지, 상한을 지키는지, low 품질과 감소된 동작에서도 같은지, 흔들림 후 카메라 회전이 원래대로 돌아오는지, `gl.getError()`가 0인지 본다.
  - 오디오: 보이스 상한, 범위 밖 소리 생략, 4.2초 뒤 보이스 전부 반환, 소리 22종 합성 완료를 본다.
  - 해제: `dispose()`를 확인한다.

## 알려진 한계

- 포인트 파티클은 `gl_PointSize`를 쓰므로 화면 크기가 480 px로 제한된다. 카메라에 아주 가까운 연기는 실제보다 작게 보인다.
- 불꽃 줄기는 WebGL 선이라 1 px 두께다. 고해상도 화면에서는 가늘게 보인다.
- 파티클은 충돌을 모른다. 불꽃과 물방울은 벽과 바닥을 통과해 떨어지다 수명이 끝나면 사라진다. 탄피만 `groundY` 평면에서 튕긴다.
- 차폐(벽 뒤 소리)는 처리하지 않는다. 거리 감쇠와 저역 통과만 한다. 도플러 효과도 없다.
- 탄흔은 표면 법선 방향으로 붙인 사각형이라 모서리에 맞으면 허공으로 삐져나올 수 있다. 움직이는 물체에는 붙이지 않는다(`player`).
- 첫 `unlock()` 직후 약 1초 동안 미리 합성이 진행된다(변형 35개를 16 ms 간격으로 하나씩). 그 사이 처음 재생하는 소리는 그 자리에서 합성된다(폭발 1회 약 30~60 ms). 메뉴 화면에서 언락하면 게임 중에는 끊김이 없다.
