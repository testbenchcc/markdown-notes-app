# Welcome to Markdown Notes

This is an example note stored as a plain `.md` file under the `notes/` folder.

- Click notes in the left-hand tree to load them.
- Use the **View/Edit** toggle in the header to switch modes.
- Click **Save** to persist changes back to disk.

Because notes are just files, you can also edit them directly with any editor
or manage them with Git.

```python
import os

# Get current working directory
cwd = os.getcwd()
print("Current directory:", cwd)

# List files in the current directory
for item in os.listdir(cwd):
    print("Found:", item)
```