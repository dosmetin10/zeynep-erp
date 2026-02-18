# MTN Muhasebe ERP

Elektron tabanlı, gerçek operasyon akışına uygun **Ön Muhasebe + Malzeme Stok + Satış Takip** masaüstü çözümü.

## Bu sürümde neler var?
- Kullanıcı giriş sistemi
- Cari yönetimi (müşteri / tedarikçi)
- Stok kartı yönetimi (minimum seviye, kritik stok uyarısı)
- Kasa gelir/gider hareketleri
- Satış faturası oluşturma (stok düşümü + müşteri bakiyesi güncelleme)
- Yönetim KPI paneli (alacak, stok değeri, kasa, aylık ciro)
- Aktivite merkezi ve kritik operasyon uyarıları
- CSV satış raporu dışa aktarma
- JSON yedekleme / geri yükleme

## Kurulum
```bash
npm install
npm start
```

## Paketleme
```bash
npm run dist
```

## Varsayılan giriş
- `mtn / 1453`
- `muhasebe / 1453`

## Mimari
```
src/
├── main.js              # Electron main + IPC (backup, csv export)
├── preload.js           # Güvenli context bridge
└── renderer/
    ├── index.html       # Ekran yapısı
    ├── app.js           # İş kuralları ve state yönetimi
    └── styles.css       # Kurumsal UI
```

0.1.0 - İlk stabil sürüm

---
*Mevcut durum: ✅ Tamamlanmış ve dağıtıma hazır*


## Electron Açılış Hatası Düzeltmesi
- `Cannot find module .../main.js` hatası için `src/main.js` ve `src/preload.js` geri eklendi.
- Electron artık bir çökme yerine güvenli bir launcher ekranı açar.
- Sunucu açıksa uygulama doğrudan web arayüzünü açar; kapalıysa gömülü sunucuyu otomatik başlatmayı dener, yine açılamazsa durum ekranı gösterir.
- Asıl üretim çalışma modeli web sunucu + tarayıcı istemcisidir (`MTN_OfficePack` bat dosyaları).
=======

