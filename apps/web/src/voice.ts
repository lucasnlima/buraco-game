import { create } from 'zustand';
import { t } from './i18n';
import { api } from './net';
import { useStore } from './store';

interface VoiceState {
  active: boolean;
  starting: boolean;
  muted: boolean;
  ptt: boolean;
  pttHeld: boolean;
  speaking: Record<string, boolean>;
  volumes: Record<string, number>;
  error: string | null;
}
export const useVoice = create<VoiceState>()(() => ({
  active: false,
  starting: false,
  muted: false,
  ptt: false,
  pttHeld: false,
  speaking: {},
  volumes: {},
  error: null,
}));

interface Peer {
  pc: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[];
  gain?: GainNode;
  analyser?: AnalyserNode;
  audio: HTMLAudioElement;
  restartTimer?: ReturnType<typeof setTimeout>;
}

class VoiceManager {
  private peers = new Map<string, Peer>();
  private local: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private iceServers: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
  private poll: ReturnType<typeof setInterval> | null = null;
  private myId = '';

  /** Deve ser chamado direto de um gesto do usuário (iOS só libera áudio assim). */
  async start(): Promise<void> {
    const st = useStore.getState();
    if (!st.myId || !st.identity || useVoice.getState().active) return;
    this.myId = st.myId;
    useVoice.setState({ starting: true, error: null });
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      await this.ctx.resume();
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (e) {
      const denied =
        e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      useVoice.setState({ starting: false, error: denied ? t.micDenied : t.micError });
      this.ctx?.close().catch(() => {});
      this.ctx = null;
      return;
    }
    this.iceServers = await api.iceServers(st.identity);
    const src = this.ctx.createMediaStreamSource(this.local);
    this.localAnalyser = this.ctx.createAnalyser();
    this.localAnalyser.fftSize = 512;
    src.connect(this.localAnalyser);
    this.applyMute();
    useVoice.setState({ active: true, starting: false });
    st.send({ t: 'voice', on: true });
    this.poll = setInterval(() => this.measure(), 120);
    window.addEventListener('online', this.onOnline);
    this.sync();
  }

  stop(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    window.removeEventListener('online', this.onOnline);
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.local?.getTracks().forEach((tr) => tr.stop());
    this.local = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    if (useVoice.getState().active) useStore.getState().send({ t: 'voice', on: false });
    useVoice.setState({ active: false, starting: false, speaking: {} });
  }

  private onOnline = (): void => {
    for (const [id, p] of this.peers) if (this.isInitiator(id)) void this.offer(id, p, true);
  };

  setMuted(muted: boolean): void {
    useVoice.setState({ muted });
    this.applyMute();
  }
  setPtt(ptt: boolean): void {
    useVoice.setState({ ptt, pttHeld: false });
    this.applyMute();
  }
  setPttHeld(held: boolean): void {
    useVoice.setState({ pttHeld: held });
    this.applyMute();
  }
  private applyMute(): void {
    const { muted, ptt, pttHeld } = useVoice.getState();
    const enabled = !muted && (!ptt || pttHeld);
    this.local?.getAudioTracks().forEach((tr) => (tr.enabled = enabled));
  }
  setVolume(id: string, v: number): void {
    useVoice.setState((s) => ({ volumes: { ...s.volumes, [id]: v } }));
    const p = this.peers.get(id);
    if (p?.gain) p.gain.gain.value = v;
    if (p?.audio) p.audio.volume = Math.min(1, v);
  }

  /** Quem tem o menor id inicia a oferta (evita "glare"). */
  private isInitiator = (peer: string): boolean => this.myId < peer;

  /** Reconcilia as conexões com quem está na voz segundo o lobby. */
  sync(): void {
    if (!useVoice.getState().active) return;
    const lobby = useStore.getState().lobby;
    if (!lobby) return;
    const inVoice = new Set(
      lobby.players.filter((p) => p.voice && p.connected && p.id !== this.myId).map((p) => p.id),
    );
    for (const id of inVoice) {
      if (!this.peers.has(id)) {
        const p = this.create(id);
        if (this.isInitiator(id)) void this.offer(id, p, false);
      }
    }
    for (const id of [...this.peers.keys()]) if (!inVoice.has(id)) this.drop(id);
  }

  private create(id: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const audio = new Audio();
    audio.autoplay = true;
    audio.setAttribute('playsinline', 'true');
    const peer: Peer = { pc, pendingIce: [], audio };
    this.peers.set(id, peer);
    this.local?.getTracks().forEach((tr) => pc.addTrack(tr, this.local!));
    pc.onicecandidate = (e) => {
      if (e.candidate)
        useStore.getState().send({ t: 'rtc', to: id, kind: 'ice', data: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      audio.muted = true; // o som sai pelo WebAudio (permite volume no iOS)
      void audio.play().catch(() => {});
      if (this.ctx) {
        const src = this.ctx.createMediaStreamSource(stream);
        peer.gain = this.ctx.createGain();
        peer.gain.gain.value = useVoice.getState().volumes[id] ?? 1;
        peer.analyser = this.ctx.createAnalyser();
        peer.analyser.fftSize = 512;
        src.connect(peer.gain).connect(this.ctx.destination);
        src.connect(peer.analyser);
      }
    };
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      clearTimeout(peer.restartTimer);
      if ((s === 'failed' || s === 'disconnected') && this.isInitiator(id)) {
        peer.restartTimer = setTimeout(
          () => void this.offer(id, peer, true),
          s === 'failed' ? 0 : 4000,
        );
      }
    };
    return peer;
  }

  private async offer(id: string, p: Peer, iceRestart: boolean): Promise<void> {
    try {
      const o = await p.pc.createOffer({ iceRestart });
      await p.pc.setLocalDescription(o);
      useStore.getState().send({ t: 'rtc', to: id, kind: 'offer', data: p.pc.localDescription });
    } catch {
      /* tenta de novo no próximo evento */
    }
  }

  async onSignal(from: string, kind: 'offer' | 'answer' | 'ice', data: unknown): Promise<void> {
    if (!useVoice.getState().active) return;
    let p = this.peers.get(from);
    if (!p) p = this.create(from);
    try {
      if (kind === 'offer') {
        await p.pc.setRemoteDescription(data as RTCSessionDescriptionInit);
        await this.flushIce(p);
        const a = await p.pc.createAnswer();
        await p.pc.setLocalDescription(a);
        useStore
          .getState()
          .send({ t: 'rtc', to: from, kind: 'answer', data: p.pc.localDescription });
      } else if (kind === 'answer') {
        await p.pc.setRemoteDescription(data as RTCSessionDescriptionInit);
        await this.flushIce(p);
      } else if (p.pc.remoteDescription) {
        await p.pc.addIceCandidate(data as RTCIceCandidateInit);
      } else {
        p.pendingIce.push(data as RTCIceCandidateInit);
      }
    } catch {
      /* sinalização obsoleta */
    }
  }
  private async flushIce(p: Peer): Promise<void> {
    for (const c of p.pendingIce.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
  }

  private drop(id: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    clearTimeout(p.restartTimer);
    p.pc.close();
    p.audio.srcObject = null;
    p.gain?.disconnect();
    this.peers.delete(id);
  }

  debugStates(): string[] {
    return [...this.peers.values()].map((p) => p.pc.connectionState);
  }

  private level(a: AnalyserNode | null | undefined): number {
    if (!a) return 0;
    const buf = new Uint8Array(a.fftSize);
    a.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += ((v - 128) / 128) ** 2;
    return Math.sqrt(sum / buf.length);
  }
  private measure(): void {
    const next: Record<string, boolean> = {};
    const { muted, ptt, pttHeld } = useVoice.getState();
    const myOn = !muted && (!ptt || pttHeld);
    next[this.myId] = myOn && this.level(this.localAnalyser) > 0.03;
    for (const [id, p] of this.peers) next[id] = this.level(p.analyser) > 0.03;
    const prev = useVoice.getState().speaking;
    if (Object.keys(next).some((k) => next[k] !== prev[k])) useVoice.setState({ speaking: next });
  }
}

export const voice = new VoiceManager();

// Gancho de depuração/testes E2E: estados das conexões P2P.
(window as unknown as { __buracoVoice: () => string[] }).__buracoVoice = () => voice.debugStates();

// Liga a sinalização do store ao gerenciador e reconcilia a cada mudança do lobby.
useStore.setState({ onRtc: (from, kind, data) => void voice.onSignal(from, kind, data) });
useStore.subscribe((s, prev) => {
  if (s.lobby !== prev.lobby) voice.sync();
  if (!s.code && prev.code && useVoice.getState().active) voice.stop();
});
