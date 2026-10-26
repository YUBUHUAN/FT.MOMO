using System.Collections.Concurrent;
using System.IO;
using System.Media;

namespace MomoPet;

/// <summary>Very small synthesized chime player: no audio files, no dependencies.</summary>
public static class TonePlayer
{
    public static bool Enabled { get; set; } = true;

    private static readonly ConcurrentDictionary<string, byte[]> Cache = new();

    public static void Tap(int combo)
    {
        double freq = 430 + Math.Clamp(combo, 1, 12) * 15;
        Play(freq, 150, 0.035);
    }

    public static void Feed() => Sequence(new[] { (392.0, 190), (523.25, 210), (659.25, 250) }, 0.042);

    public static void Outing() => Sequence(new[] { (329.63, 240), (392.0, 240), (523.25, 270), (659.25, 300) }, 0.04);

    public static void Recap() => Sequence(new[] { (523.25, 280), (659.25, 280), (783.99, 340) }, 0.04);

    public static void Error() => Sequence(new[] { (196.0, 190), (174.61, 250) }, 0.04);

    public static void Open() => Sequence(new[] { (440.0, 140), (659.25, 180) }, 0.034);

    private static void Sequence((double Freq, int Ms)[] notes, double volume)
    {
        if (!Enabled) return;
        Task.Run(async () =>
        {
            foreach (var (freq, ms) in notes)
            {
                Play(freq, ms, volume);
                await Task.Delay(Math.Max(30, ms / 2));
            }
        });
    }

    private static void Play(double freq, int ms, double volume)
    {
        if (!Enabled) return;
        try
        {
            string key = $"{freq:F2}:{ms}:{volume:F2}";
            byte[] wav = Cache.GetOrAdd(key, _ => BuildWav(freq, ms, volume));
            using var stream = new MemoryStream(wav);
            using var player = new SoundPlayer(stream);
            player.Play();
        }
        catch { }
    }

    private static byte[] BuildWav(double freq, int ms, double volume)
    {
        const int sampleRate = 22050;
        int samples = Math.Max(1, sampleRate * ms / 1000);
        int dataSize = samples * 2;
        using var msStream = new MemoryStream(44 + dataSize);
        using var w = new BinaryWriter(msStream);
        w.Write(new[] { 'R', 'I', 'F', 'F' });
        w.Write(36 + dataSize);
        w.Write(new[] { 'W', 'A', 'V', 'E' });
        w.Write(new[] { 'f', 'm', 't', ' ' });
        w.Write(16);
        w.Write((short)1);
        w.Write((short)1);
        w.Write(sampleRate);
        w.Write(sampleRate * 2);
        w.Write((short)2);
        w.Write((short)16);
        w.Write(new[] { 'd', 'a', 't', 'a' });
        w.Write(dataSize);
        for (int i = 0; i < samples; i++)
        {
            double t = (double)i / sampleRate;
            double attack = Math.Min(1, i / (sampleRate * 0.022));
            double release = Math.Min(1, (samples - i) / (sampleRate * 0.12));
            double env = Math.Sin(attack * Math.PI / 2) * Math.Sin(release * Math.PI / 2);
            // A gentle downward glide takes the edge off the attack.
            double glide = 1.0 - 0.012 * (1.0 - (double)i / samples);
            double wave = Math.Sin(2 * Math.PI * freq * glide * t);
            w.Write((short)(wave * env * volume * short.MaxValue));
        }
        w.Flush();
        return msStream.ToArray();
    }
}
