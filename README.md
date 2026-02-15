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
