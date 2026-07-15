# Yacht Motion Controller PoC

PC 브라우저를 Yacht Dice 게임 화면으로, 휴대폰을 Nintendo Switch 스타일의 모션 컨트롤러로 사용하는 WebRTC 개념 증명입니다.

## 주요 기능

- PeerJS 시그널링과 WebRTC DataChannel을 이용한 P2P 연결
- QR 스캔으로 휴대폰 컨트롤러 자동 참가
- DeviceMotion 가속도·회전 데이터 약 20Hz 실시간 전송
- 가속도, 회전, jerk를 조합한 throw energy 계산
- 부드럽게 / 보통 / 강하게 감도 프리셋
- 밀리초 단위 던짐 판정 타임라인
- 실시간 센서 파형과 임계선 표시
- 센서가 없는 개발 환경을 위한 던짐 시뮬레이터

## 사용법

1. PC에서 배포 페이지를 열고 `PC 게임 화면`을 누릅니다.
2. 표시된 QR을 휴대폰으로 스캔합니다.
3. 휴대폰에서 `모션 센서 켜기`를 누르고 권한을 허용합니다.
4. 휴대폰을 단단히 잡고 주사위를 던지듯 움직입니다.
5. PC의 실시간 그래프와 Throw timeline에서 판정 시점과 수치를 확인합니다.

> 휴대폰을 실제로 놓거나 던지지 마세요. 손에 쥔 상태의 제스처를 의미합니다.

## 로컬 실행

```powershell
npm install
npm run dev
```

`http://localhost:4173`을 엽니다. 센서 권한은 배포된 HTTPS 페이지에서 테스트하는 것이 가장 안정적입니다.

## 빌드

```powershell
npm run build
```

`main` 브랜치에 push하면 GitHub Actions가 GitHub Pages에 자동 배포합니다.

## 판정식

```text
energy = acceleration + rotation × 0.045 + jerk × 0.7
```

이 수식과 프리셋 임계값은 PoC 튜닝용입니다. 기기별 센서 편차를 고려한 정규화와 TURN 서버는 후속 과제입니다.
