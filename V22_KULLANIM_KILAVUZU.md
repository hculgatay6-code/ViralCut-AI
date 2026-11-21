# ViralCut AI v22.0.0 kullanım kılavuzu

## Başlangıç

- Yerel Windows x64 paketinde **Portable EXE** dosyasını çift tıklayarak aç. **Setup EXE** kurulum ve Windows kısayolları sağlar.
- **Kolay Editör** üzerinden video ekle, klipleri kes, sessizliği temizle, altyazıyı düzenle ve MP4 kaydet.
- **Profesyonel Editör** çok katmanlı zaman çizelgesini açar. İlk geçişte önceki kesim ve altyazılardan katmanlar oluşturulur. İki düzeni proje dosyasında saklayabilirsin.
- **AI Stüdyo**, Shorts adaylarını gösterir. Sol şeritteki **Yönetmen**, **Altyazı** ve **AI Copilot** araçları da kullanılabilir.

## Proxy ve önizleme

1. **Projeye video ekle** ile özgün dosyayı kaydet ve **Medya** panelinde seç.
2. **Proxy çözünürlüğü** listesinden 360p, 540p veya 720p seç. **Proxy kodlayıcı** ayarında CPU’yu seçebilir veya doğrulanmış NVIDIA donanımında otomatik kodlama kullanabilirsin.
3. **Hafif önizleme oluştur** düğmesine bas. Hazır olunca **Hafif önizleme** ile geçiş yap. İmleç zamanı korunur. **Orijinal önizleme** düğmesi ana kaynağı açar.
4. Profesyonel Editör’de 2, 4 veya 8 saniye seç, imleci götür ve **Buradan önizle** düğmesine bas. **Önizleme kaynağı** ayarı hazır proxy’leri kullanır. Hazır olmayan kaynaklar özgün medyadan okunur. Hazır aralık içinde imleç videoyu takip eder ve imleç hareketi videonun konumunu değiştirir.
5. **Katmanları MP4 hazırla** ve ardından **Proje MP4 dosyasını kaydet** ile çıktıyı oluştur. FFmpeg çıktıyı özgün kaynaklardan oluşturur.

Proxy önbelleği oturumlar arasında kullanılabilir. Kaynak dosyası değişirse ona ait proxy yeniden hazırlanır. Diskte en fazla 12 proxy ve toplam 2 GiB tutulur. Performans Merkezi’nden temizlenebilir. HDR dosyalar özgün önizleme kullanır. İptal edilen proxy ilk kareden yeniden başlar. Birleşik oynatım, önceden hazırlanan 2, 4 veya 8 saniyelik aralığı kullanır.

## AI kurgu ve ses

- **AI Stüdyo → Analiz et** ile 15, 30 veya 60 saniyelik adayları incele. Konuşma metni, ses ve görsel ölçümler adayları sıralamaya yardım eder. Puanlar adayları karşılaştırmak içindir.
- Başlangıç, bitiş, sessizlik, altyazı ve kadraj ayarlarını incele. Sessiz videolarda görüntü analiziyle aday oluşturulabilir. Model eksik olduğunda arayüz kullanılabilen yöntemi gösterir.
- **Seçilenleri Kolay Editöre ekle** veya **Planı Kolay Editöre ekle** seçenekleri onaylanan kesimleri sıraya ekler. Eklemenin tamamı bir işlem olarak geri alınabilir. Mevcut projenin ortak biçim ve görünüm ayarları korunur. Birden çok adayda ayrı hareketli kadrajı korumak için adayları tek tek MP4 olarak dışa aktar.
- **Ses → Ses Stüdyosu** ile seçili aralığın LUFS ve gerçek tepe değerlerini ölç. Ses/görüntü farkı dosyadaki akış başlangıç zamanlarından hesaplanır. Dinleyerek doğrulama için **Orijinal sesi dinle** ve **İşlenmiş sesi dinle** düğmelerini kullan.
- **Konuşmayı dengele**, mevcut filtreleri etkinleştirir. Gürültü azaltma ve geçiş ayarları Ses panelindedir. **Özgün sesi geri yükle** ses filtrelerini kaldırır. Katmanlı ses kazancı anahtar karelerini Profesyonel Editör’den düzenleyebilirsin.

## Performans ve proje

**Performans** panelinde CPU, RAM, varsa GPU ve VRAM, kuyruk ve önbellek ayrıntıları görünür. Düşük kaynak kullanımı için **Eco**, günlük kullanım için **Balanced**, doğrulanmış donanımı daha çok kullanmak için **Performance** profili vardır. Öncelikli video işleri için proxy işlemi durdurulabilir ve sonrasında yeniden sıraya alınır.

Projeyi `.viralcut` olarak kaydet. v1–v4 belgeleri desteklenir. Medyanın yeri değişirse projeyi aç ve özgün dosyayı yeniden bağla. Beklenmeyen kapanıştan sonra varsa **Projeyi kurtar** seçeneği görünür.
