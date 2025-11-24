<script>
  const fileInput = document.getElementById("fileInput");
  const uploadBtn = document.getElementById("uploadBtn");
  const progressBar = document.getElementById("uploadProgress");
  const label = document.getElementById("uploadLabel");

  uploadBtn.addEventListener("click", () => {
    const file = fileInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/upload");

    progressBar.style.display = "inline-block";
    progressBar.value = 0;
    label.textContent = "0 %";

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressBar.value = percent;
        label.textContent = percent + " %";
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        label.textContent = "Done";
        // optional: hide after a bit
        setTimeout(() => {
          progressBar.style.display = "none";
          label.textContent = "";
        }, 1000);
      } else {
        label.textContent = "Error";
      }
    };

    xhr.onerror = () => {
      label.textContent = "Upload failed";
    };

    xhr.send(formData);
  });
</script>
